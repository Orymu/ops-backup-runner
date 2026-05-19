#!/usr/bin/env node

import { writeFileSync } from "node:fs";

import { formatDoctorResult, runDoctor } from "./commands/doctor.js";
import { loadConfigFromFile } from "./config/loader.js";
import { selectTargets } from "./config/targets.js";
import type { BackupRunnerConfig, BackupTarget } from "./config/types.js";
import {
  restoreLocalBackupArtifact,
  runLocalBackupJob,
} from "./core/backup-job.js";
import { sha256Hex } from "./core/artifact.js";
import type { BackupManifest } from "./core/manifest.js";
import type { Dumper } from "./core/ports.js";
import { createRetentionPlan, type RetentionPlan } from "./core/retention.js";
import { fakeDumper } from "./dumpers/fake.js";
import { createPostgresDockerDumper } from "./dumpers/postgres-docker.js";
import { createAgeEncryptionAdapter } from "./encryption/age.js";
import { noneEncryptionAdapter } from "./encryption/none.js";
import {
  getEffectiveEncryptionConfig,
  getExternalStorageEncryptionIssue,
} from "./encryption/policy.js";
import { createLocalStorageAdapter } from "./storage/local.js";

export const cliName = "ops-backup-runner";
export const exitCodes = {
  success: 0,
  runtimeFailure: 1,
  usage: 2,
  verificationFailure: 3,
} as const;

export type CliExitCode = (typeof exitCodes)[keyof typeof exitCodes];

export interface CliResult {
  exitCode: CliExitCode;
  stdout: string;
  stderr: string;
}

export const getStartupMessage = (): string =>
  `${cliName}: project harness initialized. Run --help to see available commands.`;

const getFlagValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
};

const hasFlag = (args: string[], flag: string): boolean => args.includes(flag);

const renderGlobalHelp = (): string =>
  [
    cliName,
    "",
    "Usage:",
    "  ops-backup-runner <command> [options]",
    "",
    "Commands:",
    "  doctor   Validate config and required runtime environment.",
    "  backup   Run local fake backup pipeline or validate selection with --dry-run.",
    "  list     List local backup manifests.",
    "  verify   Verify local backup artifact integrity.",
    "  restore  Restore a local backup artifact to a file.",
    "  prune    Prune backups. Placeholder until retention exists.",
    "",
    "Common options:",
    "  --config <path>  Path to YAML target config.",
    "  --json           Emit machine-readable JSON.",
    "  --help           Show help.",
  ].join("\n");

const renderCommandHelp = (command: string): string => {
  const helpByCommand: Record<string, string[]> = {
    doctor: [
      "Usage: ops-backup-runner doctor --config <path> [--json]",
      "",
      "Validates config shape and required runtime environment.",
    ],
    backup: [
      "Usage: ops-backup-runner backup <target|all> --config <path> [--dry-run] [--json]",
      "",
      "Runs fake dumper -> gzip -> local storage for local targets.",
    ],
    list: [
      "Usage: ops-backup-runner list <target> --config <path> [--json]",
      "",
      "Lists local backup manifests for selected targets.",
    ],
    verify: [
      "Usage: ops-backup-runner verify <target> --config <path> [--latest] [--json]",
      "",
      "Verifies local artifact sha256. Use --latest to verify only the newest manifest.",
    ],
    restore: [
      "Usage: ops-backup-runner restore <target> --backup <id> --output <path> --config <path> [--json]",
      "",
      "Restores a local gzip artifact to the given output path.",
    ],
    prune: [
      "Usage: ops-backup-runner prune <target> --config <path> [--dry-run] [--json]",
      "",
      "Validates target selection. Retention pruning is implemented after storage exists.",
    ],
  };

  return (helpByCommand[command] ?? [renderGlobalHelp()]).join("\n");
};

const renderJson = (value: unknown): string => `${JSON.stringify(value)}\n`;

const success = (stdout: string): CliResult => ({
  exitCode: exitCodes.success,
  stdout: stdout.endsWith("\n") ? stdout : `${stdout}\n`,
  stderr: "",
});

const failure = (exitCode: CliExitCode, stderr: string): CliResult => ({
  exitCode,
  stdout: "",
  stderr: stderr.endsWith("\n") ? stderr : `${stderr}\n`,
});

const loadConfigForCommand = (
  args: string[]
):
  | {
      ok: true;
      config: BackupRunnerConfig;
    }
  | {
      ok: false;
      result: CliResult;
    } => {
  const configPath = getFlagValue(args, "--config");
  if (configPath === undefined) {
    return {
      ok: false,
      result: failure(exitCodes.usage, "Missing required --config <path>."),
    };
  }

  const loadResult = loadConfigFromFile(configPath);
  if (!loadResult.ok) {
    return {
      ok: false,
      result: failure(
        exitCodes.usage,
        [
          `Config failed: ${loadResult.message}`,
          ...loadResult.issues.map((issue) => `- ${issue}`),
        ].join("\n")
      ),
    };
  }

  return {
    ok: true,
    config: loadResult.config,
  };
};

const selectTargetsForCommand = (
  args: string[],
  config: BackupRunnerConfig,
  targetId: string | undefined
):
  | {
      ok: true;
      targets: BackupTarget[];
    }
  | {
      ok: false;
      result: CliResult;
    } => {
  if (targetId === undefined) {
    return {
      ok: false,
      result: failure(exitCodes.usage, "Missing required target argument."),
    };
  }

  const selection = selectTargets(config, targetId);
  if (!selection.ok) {
    const json = hasFlag(args, "--json");
    return {
      ok: false,
      result: json
        ? failure(
            exitCodes.usage,
            renderJson({ ok: false, error: selection.message })
          )
        : failure(exitCodes.usage, selection.message),
    };
  }

  return selection;
};

const getLocalStorageForTarget = (
  config: BackupRunnerConfig,
  target: BackupTarget
):
  | {
      ok: true;
      storage: ReturnType<typeof createLocalStorageAdapter>;
    }
  | {
      ok: false;
      message: string;
    } => {
  const externalStorageEncryptionIssue = getExternalStorageEncryptionIssue(
    config,
    target
  );
  if (externalStorageEncryptionIssue !== undefined) {
    return {
      ok: false,
      message: externalStorageEncryptionIssue,
    };
  }

  if (target.storage.type !== "local") {
    return {
      ok: false,
      message: `${target.id} uses ${target.storage.type} storage. Phase 4 only supports local storage.`,
    };
  }

  return {
    ok: true,
    storage: createLocalStorageAdapter(target),
  };
};

const getLocalBackupTarget = (
  config: BackupRunnerConfig,
  target: BackupTarget
):
  | {
      ok: true;
      storage: ReturnType<typeof createLocalStorageAdapter>;
    }
  | {
      ok: false;
      result: CliResult;
    } => {
  const storage = getLocalStorageForTarget(config, target);
  if (!storage.ok) {
    return {
      ok: false,
      result: failure(exitCodes.runtimeFailure, storage.message),
    };
  }

  return storage;
};

const getDumperForTarget = (target: BackupTarget): Dumper<BackupTarget> => {
  if (target.dumper.type === "fake") return fakeDumper;
  return createPostgresDockerDumper();
};

const getEncryptionForTarget = (
  config: BackupRunnerConfig,
  target: BackupTarget
) => {
  const encryption = getEffectiveEncryptionConfig(config, target);
  if (encryption.type === "none") return noneEncryptionAdapter;
  return createAgeEncryptionAdapter(config, target);
};

const findManifestByBackupId = (
  manifests: BackupManifest[],
  backupId: string
): BackupManifest | undefined =>
  manifests.find((manifest) => manifest.backupId === backupId);

const sortManifestsNewestFirst = (
  manifests: BackupManifest[]
): BackupManifest[] =>
  [...manifests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const getRetentionPolicyForTarget = (
  config: BackupRunnerConfig,
  target: BackupTarget
) => target.retention ?? config.defaults?.retention ?? {};

const createPrunePlanForTarget = (
  config: BackupRunnerConfig,
  target: BackupTarget
):
  | {
      ok: true;
      storage: ReturnType<typeof createLocalStorageAdapter>;
      plan: RetentionPlan;
    }
  | {
      ok: false;
      result: CliResult;
    } => {
  const storage = getLocalStorageForTarget(config, target);
  if (!storage.ok) {
    return {
      ok: false,
      result: failure(exitCodes.runtimeFailure, storage.message),
    };
  }

  return {
    ok: true,
    storage: storage.storage,
    plan: createRetentionPlan({
      manifests: storage.storage.listManifests(target.id),
      objectKeys: storage.storage.listObjectKeys?.(target.id) ?? [],
      policy: getRetentionPolicyForTarget(config, target),
    }),
  };
};

const runDoctorCommand = (args: string[]): CliResult => {
  const configPath = getFlagValue(args, "--config");
  const json = hasFlag(args, "--json");

  if (configPath === undefined) {
    const message = "Doctor failed: missing --config <path>";
    return json
      ? failure(exitCodes.usage, renderJson({ ok: false, error: message }))
      : failure(exitCodes.usage, message);
  }

  const result = runDoctor(configPath);
  if (json) {
    return result.ok
      ? success(
          renderJson({
            ok: true,
            targets: result.targets,
            config: result.redactedConfig,
          })
        )
      : failure(
          exitCodes.usage,
          renderJson({
            ok: false,
            error: result.message,
            issues: result.issues,
          })
        );
  }

  const formatted = formatDoctorResult(result);
  return result.ok ? success(formatted) : failure(exitCodes.usage, formatted);
};

const runBackupCommand = (args: string[]): CliResult => {
  const targetId = args[1];
  const json = hasFlag(args, "--json");
  const dryRun = hasFlag(args, "--dry-run");
  const configResult = loadConfigForCommand(args);
  if (!configResult.ok) return configResult.result;

  const selection = selectTargetsForCommand(
    args,
    configResult.config,
    targetId
  );
  if (!selection.ok) return selection.result;

  if (dryRun) {
    const targetIds = selection.targets.map((target) => target.id);
    if (json) {
      return success(
        renderJson({
          ok: true,
          dryRun: true,
          command: "backup",
          targets: targetIds,
        })
      );
    }

    return success(
      [
        "Backup dry run passed.",
        ...targetIds.map((target) => `- ${target}`),
        "No dump, upload, prune, or notification side effects were executed.",
      ].join("\n")
    );
  }

  const manifests: BackupManifest[] = [];
  for (const target of selection.targets) {
    const localTarget = getLocalBackupTarget(configResult.config, target);
    if (!localTarget.ok) return localTarget.result;

    const result = runLocalBackupJob(
      target,
      getDumperForTarget(target),
      localTarget.storage,
      getEncryptionForTarget(configResult.config, target)
    );
    manifests.push(result.manifest);
  }

  if (json) {
    return success(
      renderJson({
        ok: true,
        command: "backup",
        backups: manifests,
      })
    );
  }

  return success(
    [
      "Backup completed.",
      ...manifests.map(
        (manifest) =>
          `- ${manifest.targetId}: ${manifest.backupId} -> ${manifest.storage.artifactKey}`
      ),
    ].join("\n")
  );
};

const runListCommand = (args: string[]): CliResult => {
  const targetId = args[1];
  const json = hasFlag(args, "--json");
  const configResult = loadConfigForCommand(args);
  if (!configResult.ok) return configResult.result;

  const selection = selectTargetsForCommand(
    args,
    configResult.config,
    targetId
  );
  if (!selection.ok) return selection.result;

  const manifests = selection.targets.flatMap((target) => {
    const storage = getLocalStorageForTarget(configResult.config, target);
    if (!storage.ok) return [];
    return storage.storage.listManifests(target.id);
  });

  if (json) {
    return success(
      renderJson({
        ok: true,
        command: "list",
        backups: manifests,
      })
    );
  }

  if (manifests.length === 0) {
    return success("No backups found.");
  }

  return success(
    [
      "Backups:",
      ...manifests.map(
        (manifest) =>
          `- ${manifest.targetId}: ${manifest.backupId} (${String(
            manifest.artifact.sizeBytes
          )} bytes)`
      ),
    ].join("\n")
  );
};

const runVerifyCommand = (args: string[]): CliResult => {
  const targetId = args[1];
  const json = hasFlag(args, "--json");
  const latestOnly = hasFlag(args, "--latest");
  const configResult = loadConfigForCommand(args);
  if (!configResult.ok) return configResult.result;

  const selection = selectTargetsForCommand(
    args,
    configResult.config,
    targetId
  );
  if (!selection.ok) return selection.result;

  const results: {
    backupId: string;
    targetId: string;
    ok: boolean;
  }[] = [];

  for (const target of selection.targets) {
    const storage = getLocalStorageForTarget(configResult.config, target);
    if (!storage.ok) return failure(exitCodes.runtimeFailure, storage.message);

    const manifests = latestOnly
      ? sortManifestsNewestFirst(
          storage.storage.listManifests(target.id)
        ).slice(0, 1)
      : storage.storage.listManifests(target.id);

    for (const manifest of manifests) {
      const artifactBytes = storage.storage.readArtifact(manifest);
      results.push({
        backupId: manifest.backupId,
        targetId: manifest.targetId,
        ok: sha256Hex(artifactBytes) === manifest.artifact.sha256,
      });
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (json) {
    const payload = {
      ok: failed.length === 0,
      command: "verify",
      results,
    };
    return failed.length === 0
      ? success(renderJson(payload))
      : failure(exitCodes.verificationFailure, renderJson(payload));
  }

  if (results.length === 0) {
    return failure(
      exitCodes.verificationFailure,
      "No backups found to verify."
    );
  }

  if (failed.length > 0) {
    return failure(
      exitCodes.verificationFailure,
      [
        "Backup verification failed.",
        ...failed.map((result) => `- ${result.targetId}: ${result.backupId}`),
      ].join("\n")
    );
  }

  return success(
    [
      "Backup verification passed.",
      ...results.map((result) => `- ${result.targetId}: ${result.backupId}`),
    ].join("\n")
  );
};

const runRestoreCommand = (args: string[]): CliResult => {
  const targetId = args[1];
  const json = hasFlag(args, "--json");
  const backupId = getFlagValue(args, "--backup");
  const outputPath = getFlagValue(args, "--output");
  const configResult = loadConfigForCommand(args);
  if (!configResult.ok) return configResult.result;

  if (backupId === undefined) {
    return failure(exitCodes.usage, "Missing required --backup <id>.");
  }
  if (outputPath === undefined) {
    return failure(exitCodes.usage, "Missing required --output <path>.");
  }

  const selection = selectTargetsForCommand(
    args,
    configResult.config,
    targetId
  );
  if (!selection.ok) return selection.result;
  if (selection.targets.length !== 1) {
    return failure(exitCodes.usage, "Restore requires exactly one target.");
  }

  const target = selection.targets[0];
  if (target === undefined) {
    return failure(exitCodes.usage, "Restore requires exactly one target.");
  }

  const storage = getLocalStorageForTarget(configResult.config, target);
  if (!storage.ok) return failure(exitCodes.runtimeFailure, storage.message);

  const manifest = findManifestByBackupId(
    storage.storage.listManifests(target.id),
    backupId
  );
  if (manifest === undefined) {
    return failure(exitCodes.usage, `Backup not found: ${backupId}`);
  }

  const restoredBytes = restoreLocalBackupArtifact(
    storage.storage.readArtifact(manifest),
    getEncryptionForTarget(configResult.config, target)
  );
  writeFileSync(outputPath, restoredBytes);

  if (json) {
    return success(
      renderJson({
        ok: true,
        command: "restore",
        backupId,
        outputPath,
      })
    );
  }

  return success(`Restored ${backupId} to ${outputPath}.`);
};

const runPruneCommand = (args: string[]): CliResult => {
  const targetId = args[1];
  const json = hasFlag(args, "--json");
  const dryRun = hasFlag(args, "--dry-run");
  const configResult = loadConfigForCommand(args);
  if (!configResult.ok) return configResult.result;

  const selection = selectTargetsForCommand(
    args,
    configResult.config,
    targetId
  );
  if (!selection.ok) return selection.result;

  const plans: { targetId: string; plan: RetentionPlan }[] = [];
  for (const target of selection.targets) {
    const result = createPrunePlanForTarget(configResult.config, target);
    if (!result.ok) return result.result;

    plans.push({ targetId: target.id, plan: result.plan });

    if (!dryRun) {
      for (const item of result.plan.delete) {
        try {
          result.storage.deleteObject?.(item.artifactKey);
          result.storage.deleteObject?.(item.manifestKey);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown prune error";
          return failure(
            exitCodes.runtimeFailure,
            `Prune failed after planning target ${target.id}: ${message}`
          );
        }
      }
    }
  }

  if (json) {
    return success(
      renderJson({
        ok: true,
        command: "prune",
        dryRun,
        plans,
      })
    );
  }

  const lines = [dryRun ? "Prune dry run plan:" : "Prune completed:"];
  for (const { targetId: planTargetId, plan } of plans) {
    lines.push(`Target: ${planTargetId}`);
    lines.push(`  keep: ${String(plan.keep.length)}`);
    lines.push(`  delete: ${String(plan.delete.length)}`);
    for (const item of plan.delete) {
      lines.push(`  - delete ${item.backupId} (${item.reason})`);
    }
    if (plan.unknownObjectKeys.length > 0) {
      lines.push("  unknown objects not deleted:");
      for (const key of plan.unknownObjectKeys) {
        lines.push(`  - ${key}`);
      }
    }
  }

  return success(lines.join("\n"));
};

export const runCli = (args: string[]): CliResult => {
  const command = args[0];

  if (
    command === undefined ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    return success(renderGlobalHelp());
  }

  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    return success(renderCommandHelp(command));
  }

  if (command === "doctor") return runDoctorCommand(args);
  if (command === "backup") return runBackupCommand(args);
  if (command === "list") return runListCommand(args);
  if (command === "verify") return runVerifyCommand(args);
  if (command === "restore") return runRestoreCommand(args);
  if (command === "prune") return runPruneCommand(args);

  return failure(
    exitCodes.usage,
    `Unknown command: ${command}\n\n${renderGlobalHelp()}`
  );
};

export const main = (): void => {
  const result = runCli(process.argv.slice(2));
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
};

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  main();
}
