import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { loadConfigFromFile } from "../config/loader.js";
import { redactConfigPreview } from "../config/redact.js";
import { resolveTargetEnvReferences } from "../config/env.js";
import type { BackupRunnerConfig, BackupTarget } from "../config/types.js";
import { checkPostgresDockerTarget } from "../dumpers/postgres-docker.js";
import { getExternalStorageEncryptionIssue } from "../encryption/policy.js";

export interface DoctorTargetResult {
  id: string;
  enabled: boolean;
  ok: boolean;
  status: "ready" | "disabled" | "missing-env";
  issues: string[];
}

export interface DoctorInstallResult {
  installDir: string;
  ok: boolean;
  issues: string[];
}

export type DoctorResult =
  | {
      ok: true;
      config: BackupRunnerConfig;
      redactedConfig: BackupRunnerConfig;
      targets: DoctorTargetResult[];
      install: DoctorInstallResult | undefined;
    }
  | {
      ok: false;
      message: string;
      issues: string[];
    };

const requiredInstallPaths = [
  "dist/cli.js",
  "config/targets.yaml",
  "secrets",
  ".env",
] as const;

const inspectInstall = (installDir: string): DoctorInstallResult => {
  const issues: string[] = [];

  if (!existsSync(installDir) || !statSync(installDir).isDirectory()) {
    return {
      installDir,
      ok: false,
      issues: [`Install directory does not exist: ${installDir}`],
    };
  }

  for (const relativePath of requiredInstallPaths) {
    const fullPath = path.join(installDir, relativePath);
    if (!existsSync(fullPath)) {
      issues.push(`Missing install path: ${relativePath}`);
      continue;
    }

    if (relativePath === "secrets" && !statSync(fullPath).isDirectory()) {
      issues.push("Install path must be a directory: secrets");
    }
  }

  return {
    installDir,
    ok: issues.length === 0,
    issues,
  };
};

const inspectTarget = (
  config: BackupRunnerConfig,
  target: BackupTarget
): DoctorTargetResult => {
  if (!target.enabled) {
    return {
      id: target.id,
      enabled: false,
      ok: true,
      status: "disabled",
      issues: [],
    };
  }

  const envResult = resolveTargetEnvReferences(config, target);
  const postgresDockerResult = checkPostgresDockerTarget(target);
  const externalStorageEncryptionIssue = getExternalStorageEncryptionIssue(
    config,
    target
  );
  const issues = [
    ...envResult.issues.map((issue) => issue.message),
    ...postgresDockerResult.issues,
    ...(externalStorageEncryptionIssue === undefined
      ? []
      : [externalStorageEncryptionIssue]),
  ];

  return {
    id: target.id,
    enabled: true,
    ok: issues.length === 0,
    status: issues.length === 0 ? "ready" : "missing-env",
    issues,
  };
};

export const runDoctor = (
  configPath: string,
  options: { installDir?: string } = {}
): DoctorResult => {
  const loadResult = loadConfigFromFile(configPath);
  if (!loadResult.ok) {
    return loadResult;
  }

  const targets = loadResult.config.targets.map((target) =>
    inspectTarget(loadResult.config, target)
  );
  const failedTargets = targets.filter((target) => !target.ok);
  const install =
    options.installDir === undefined
      ? undefined
      : inspectInstall(options.installDir);

  if (failedTargets.length > 0 || install?.ok === false) {
    return {
      ok: false,
      message: "Config is valid, but install or runtime checks failed.",
      issues: [
        ...failedTargets.flatMap((target) => target.issues),
        ...(install?.issues ?? []),
      ],
    };
  }

  return {
    ok: true,
    config: loadResult.config,
    redactedConfig: redactConfigPreview(
      loadResult.config
    ) as BackupRunnerConfig,
    targets,
    install,
  };
};

export const formatDoctorResult = (result: DoctorResult): string => {
  if (!result.ok) {
    return [
      `Doctor failed: ${result.message}`,
      ...result.issues.map((issue) => `- ${issue}`),
    ].join("\n");
  }

  return [
    "Doctor passed.",
    ...result.targets.map((target) => `- ${target.id}: ${target.status}`),
    ...(result.install === undefined
      ? []
      : [`- install: ${result.install.installDir}`]),
  ].join("\n");
};
