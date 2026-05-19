import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { exitCodes, runCli } from "../src/cli.js";
import type { BackupManifest } from "../src/core/manifest.js";
import { createRetentionPlan } from "../src/core/retention.js";

const manifest = (backupId: string, createdAt: string): BackupManifest => ({
  version: 1,
  backupId,
  targetId: "local-demo",
  createdAt,
  artifact: {
    key: `local-demo/artifacts/${backupId}.dump.gz`,
    sizeBytes: 10,
    sha256: "a".repeat(64),
    compression: "gzip",
    encryption: "none",
  },
  storage: {
    type: "local",
    artifactKey: `local-demo/artifacts/${backupId}.dump.gz`,
    manifestKey: `local-demo/manifests/${backupId}.json`,
  },
});

const writeConfig = (storageRoot: string): string => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "ops-backup-runner-prune-")
  );
  const file = path.join(directory, "targets.yaml");
  writeFileSync(
    file,
    [
      "version: 1",
      "targets:",
      "  - id: local-demo",
      "    enabled: true",
      "    dumper:",
      "      type: fake",
      "      bytes: dump",
      "    storage:",
      "      type: local",
      `      rootPath: ${storageRoot}`,
      "    encryption:",
      "      type: none",
      "    retention:",
      "      keepDaily: 1",
      "      maxAgeDays: 1",
    ].join("\n"),
    "utf8"
  );
  return file;
};

const writeStoredBackup = (storageRoot: string, item: BackupManifest): void => {
  const artifactPath = path.join(storageRoot, item.storage.artifactKey);
  const manifestPath = path.join(storageRoot, item.storage.manifestKey);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(artifactPath, "artifact", "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(item, null, 2)}\n`, "utf8");
};

describe("retention planner", () => {
  it("keeps newest daily backup and deletes older expired manifest-backed pairs", () => {
    const newest = manifest("newest", "2026-05-19T00:00:00.000Z");
    const older = manifest("older", "2026-05-17T00:00:00.000Z");

    const plan = createRetentionPlan({
      manifests: [older, newest],
      objectKeys: [
        newest.storage.artifactKey,
        newest.storage.manifestKey,
        older.storage.artifactKey,
        older.storage.manifestKey,
      ],
      policy: {
        keepDaily: 1,
        maxAgeDays: 1,
      },
      now: new Date("2026-05-19T12:00:00.000Z"),
    });

    expect(plan.keep.map((item) => item.backupId)).toEqual(["newest"]);
    expect(plan.delete.map((item) => item.backupId)).toEqual(["older"]);
  });

  it("keeps manual backups and reports unknown objects without deleting them", () => {
    const manual = manifest("manual", "2026-05-10T00:00:00.000Z");
    const expired = manifest("expired", "2026-05-09T00:00:00.000Z");

    const plan = createRetentionPlan({
      manifests: [manual, expired],
      objectKeys: [
        manual.storage.artifactKey,
        manual.storage.manifestKey,
        expired.storage.artifactKey,
        expired.storage.manifestKey,
        "local-demo/random/unknown.bin",
      ],
      policy: {
        keepManual: ["manual"],
        maxAgeDays: 1,
      },
      now: new Date("2026-05-19T12:00:00.000Z"),
    });

    expect(plan.keep.map((item) => item.backupId)).toEqual(["manual"]);
    expect(plan.delete.map((item) => item.backupId)).toEqual(["expired"]);
    expect(plan.unknownObjectKeys).toEqual(["local-demo/random/unknown.bin"]);
  });

  it("prune dry-run prints deletion plan without deleting files", () => {
    const storageRoot = mkdtempSync(
      path.join(tmpdir(), "ops-backup-runner-storage-")
    );
    const configPath = writeConfig(storageRoot);
    const oldBackup = manifest("old", "2026-05-17T00:00:00.000Z");
    const newBackup = manifest("new", new Date().toISOString());
    writeStoredBackup(storageRoot, oldBackup);
    writeStoredBackup(storageRoot, newBackup);
    const unknownPath = path.join(storageRoot, "local-demo/random/unknown.bin");
    mkdirSync(path.dirname(unknownPath), { recursive: true });
    writeFileSync(unknownPath, "unknown", "utf8");

    const result = runCli([
      "prune",
      "local-demo",
      "--dry-run",
      "--config",
      configPath,
    ]);

    expect(result.exitCode).toBe(exitCodes.success);
    expect(result.stdout).toContain("Prune dry run plan:");
    expect(result.stdout).toContain("delete old");
    expect(result.stdout).toContain("unknown objects not deleted");
    expect(
      readFileSync(
        path.join(storageRoot, oldBackup.storage.artifactKey),
        "utf8"
      )
    ).toBe("artifact");
  });

  it("prune execution deletes only manifest-backed artifact and manifest pairs", () => {
    const storageRoot = mkdtempSync(
      path.join(tmpdir(), "ops-backup-runner-storage-")
    );
    const configPath = writeConfig(storageRoot);
    const oldBackup = manifest("old", "2026-05-17T00:00:00.000Z");
    const newBackup = manifest("new", new Date().toISOString());
    writeStoredBackup(storageRoot, oldBackup);
    writeStoredBackup(storageRoot, newBackup);
    const unknownPath = path.join(storageRoot, "local-demo/random/unknown.bin");
    mkdirSync(path.dirname(unknownPath), { recursive: true });
    writeFileSync(unknownPath, "unknown", "utf8");

    const result = runCli(["prune", "local-demo", "--config", configPath]);

    expect(result.exitCode).toBe(exitCodes.success);
    expect(result.stdout).toContain("Prune completed:");
    expect(() =>
      readFileSync(
        path.join(storageRoot, oldBackup.storage.artifactKey),
        "utf8"
      )
    ).toThrow();
    expect(() =>
      readFileSync(
        path.join(storageRoot, oldBackup.storage.manifestKey),
        "utf8"
      )
    ).toThrow();
    expect(
      readFileSync(
        path.join(storageRoot, newBackup.storage.artifactKey),
        "utf8"
      )
    ).toBe("artifact");
    expect(readFileSync(unknownPath, "utf8")).toBe("unknown");
  });
});
