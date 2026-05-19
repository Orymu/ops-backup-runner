import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cliName, exitCodes, getStartupMessage, runCli } from "../src/cli.js";

const writeConfig = (content: string): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "ops-backup-runner-cli-"));
  const file = path.join(directory, "targets.yaml");
  writeFileSync(file, content, "utf8");
  return file;
};

const enabledConfig = `
version: 1
targets:
  - id: maintana
    enabled: true
    dumper:
      type: postgresDocker
      container: maintana-postgres
      database: maintana
      username: maintana
    storage:
      type: s3
      endpoint: https://example-account-id.r2.cloudflarestorage.com
      region: auto
      bucket: maintana-backups
  - id: kevly
    enabled: false
    dumper:
      type: postgresDocker
      container: kevly-postgres
      database: kevly
      username: kevly
    storage:
      type: s3
      endpoint: https://example-account-id.r2.cloudflarestorage.com
      region: auto
      bucket: kevly-backups
`;

const localConfig = (storageRoot: string): string => `
version: 1
targets:
  - id: local-demo
    enabled: true
    dumper:
      type: fake
      bytes: local fake dump
    storage:
      type: local
      rootPath: ${storageRoot}
    encryption:
      type: none
`;

describe("cli harness baseline", () => {
  it("exposes the CLI name", () => {
    expect(cliName).toBe("ops-backup-runner");
  });

  it("keeps a startup message for direct invocation without args", () => {
    expect(getStartupMessage()).toContain("project harness initialized");
  });

  it("shows global help", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(exitCodes.success);
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("backup");
  });

  it("shows command help", () => {
    const result = runCli(["backup", "--help"]);

    expect(result.exitCode).toBe(exitCodes.success);
    expect(result.stdout).toContain("backup <target|all>");
  });

  it("fails clearly for unknown commands", () => {
    const result = runCli(["missing"]);

    expect(result.exitCode).toBe(exitCodes.usage);
    expect(result.stderr).toContain("Unknown command: missing");
  });

  it("fails clearly for unknown targets", () => {
    const result = runCli([
      "backup",
      "unknown",
      "--dry-run",
      "--config",
      writeConfig(enabledConfig),
    ]);

    expect(result.exitCode).toBe(exitCodes.usage);
    expect(result.stderr).toContain("Unknown target: unknown");
  });

  it("lists enabled targets for backup all dry run", () => {
    const result = runCli([
      "backup",
      "all",
      "--dry-run",
      "--config",
      writeConfig(enabledConfig),
    ]);

    expect(result.exitCode).toBe(exitCodes.success);
    expect(result.stdout).toContain("Backup dry run passed.");
    expect(result.stdout).toContain("- maintana");
    expect(result.stdout).not.toContain("- kevly");
    expect(result.stdout).toContain("No dump, upload, prune, or notification");
  });

  it("emits JSON for backup dry run", () => {
    const result = runCli([
      "backup",
      "all",
      "--dry-run",
      "--json",
      "--config",
      writeConfig(enabledConfig),
    ]);

    expect(result.exitCode).toBe(exitCodes.success);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      dryRun: true,
      command: "backup",
      targets: ["maintana"],
    });
  });

  it("rejects real backup execution for unsupported storage adapters", () => {
    const result = runCli([
      "backup",
      "maintana",
      "--config",
      writeConfig(enabledConfig),
    ]);

    expect(result.exitCode).toBe(exitCodes.runtimeFailure);
    expect(result.stderr).toContain(
      "external s3 storage with encryption: none"
    );
  });

  it("runs local backup, lists it, verifies it, and restores it", () => {
    const storageRoot = mkdtempSync(
      path.join(tmpdir(), "ops-backup-runner-storage-")
    );
    const outputPath = path.join(storageRoot, "restored.dump");
    const configPath = writeConfig(localConfig(storageRoot));

    const backupResult = runCli([
      "backup",
      "local-demo",
      "--config",
      configPath,
    ]);

    expect(backupResult.exitCode).toBe(exitCodes.success);
    expect(backupResult.stdout).toContain("Backup completed.");

    const backupId = /local-demo: (?<backupId>local-demo-[^ ]+)/.exec(
      backupResult.stdout
    )?.groups?.["backupId"];
    expect(backupId).toBeDefined();
    if (backupId === undefined) return;

    const listResult = runCli(["list", "local-demo", "--config", configPath]);

    expect(listResult.exitCode).toBe(exitCodes.success);
    expect(listResult.stdout).toContain(backupId);

    const verifyResult = runCli([
      "verify",
      "local-demo",
      "--latest",
      "--config",
      configPath,
    ]);

    expect(verifyResult.exitCode).toBe(exitCodes.success);
    expect(verifyResult.stdout).toContain("Backup verification passed.");

    const restoreResult = runCli([
      "restore",
      "local-demo",
      "--backup",
      backupId,
      "--output",
      outputPath,
      "--config",
      configPath,
    ]);

    expect(restoreResult.exitCode).toBe(exitCodes.success);
    expect(readFileSync(outputPath, "utf8")).toBe("local fake dump");
  });

  it("rejects prune for unsupported external storage targets", () => {
    const result = runCli([
      "prune",
      "maintana",
      "--config",
      writeConfig(enabledConfig),
    ]);

    expect(result.exitCode).toBe(exitCodes.runtimeFailure);
    expect(result.stderr).toContain(
      "external s3 storage with encryption: none"
    );
  });
});
