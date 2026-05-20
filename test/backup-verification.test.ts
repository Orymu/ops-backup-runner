import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { BackupTarget } from "../src/config/types.js";
import { sha256Hex } from "../src/core/artifact.js";
import { verifyBackupArtifact } from "../src/core/backup-verification.js";
import type { BackupManifest } from "../src/core/manifest.js";
import { noneEncryptionAdapter } from "../src/encryption/none.js";
import type { ProcessRunner } from "../src/dumpers/postgres-docker.js";

const postgresTarget: BackupTarget = {
  id: "maintana",
  enabled: true,
  dumper: {
    type: "postgresDocker",
    container: "maintana-postgres",
    database: "maintana",
    username: "maintana",
    format: "custom",
  },
  storage: {
    type: "local",
    rootPath: "/tmp/backups",
  },
  encryption: {
    type: "none",
  },
};

const artifactBytes = gzipSync(Buffer.from("custom postgres dump"));

const manifest = (sha256 = sha256Hex(artifactBytes)): BackupManifest => ({
  version: 1,
  backupId: "maintana-2026-05-19T09-17-00Z",
  targetId: "maintana",
  createdAt: "2026-05-19T09:17:00.000Z",
  artifact: {
    key: "maintana/artifacts/maintana.dump.gz",
    sizeBytes: artifactBytes.byteLength,
    sha256,
    compression: "gzip",
    encryption: "none",
  },
  storage: {
    type: "local",
    artifactKey: "maintana/artifacts/maintana.dump.gz",
    manifestKey: "maintana/manifests/maintana.json",
  },
});

describe("backup artifact verification", () => {
  it("runs pg_restore list for valid PostgreSQL custom dumps and cleans temp files", () => {
    let dumpPath: string | undefined;
    const calls: { command: string; args: string[] }[] = [];
    const runner: ProcessRunner = (command, args) => {
      calls.push({ command, args });
      dumpPath = args[1];
      expect(dumpPath).toBeDefined();
      expect(existsSync(String(dumpPath))).toBe(true);
      return {
        status: 0,
        stdout: Buffer.from("table list"),
        stderr: "",
      };
    };

    const result = verifyBackupArtifact({
      target: postgresTarget,
      manifest: manifest(),
      artifactBytes,
      encryption: noneEncryptionAdapter,
      processRunner: runner,
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual({
      checksum: true,
      restore: true,
      postgresRestoreList: true,
    });
    expect(result.tempWorkspaceCleaned).toBe(true);
    expect(calls).toEqual([
      {
        command: "pg_restore",
        args: ["--list", String(dumpPath)],
      },
    ]);
    expect(existsSync(String(dumpPath))).toBe(false);
  });

  it("fails checksum verification without running pg_restore", () => {
    const calls: string[] = [];
    const runner: ProcessRunner = (command) => {
      calls.push(command);
      return {
        status: 0,
        stdout: Buffer.alloc(0),
        stderr: "",
      };
    };

    const result = verifyBackupArtifact({
      target: postgresTarget,
      manifest: manifest("b".repeat(64)),
      artifactBytes,
      encryption: noneEncryptionAdapter,
      processRunner: runner,
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual({
      checksum: false,
      restore: false,
    });
    expect(result.issues).toContain(
      "Checksum mismatch for backup maintana-2026-05-19T09-17-00Z."
    );
    expect(calls).toEqual([]);
  });

  it("fails when pg_restore list rejects the restored dump", () => {
    const runner: ProcessRunner = () => ({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: "input file does not appear to be a valid archive",
    });

    const result = verifyBackupArtifact({
      target: postgresTarget,
      manifest: manifest(),
      artifactBytes,
      encryption: noneEncryptionAdapter,
      processRunner: runner,
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual({
      checksum: true,
      restore: true,
      postgresRestoreList: false,
    });
    expect(result.issues).toEqual([
      "PostgreSQL restore-list verification failed for maintana: input file does not appear to be a valid archive",
    ]);
    expect(result.tempWorkspaceCleaned).toBe(true);
  });
});
