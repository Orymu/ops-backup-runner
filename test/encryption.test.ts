import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctor } from "../src/commands/doctor.js";
import {
  resetRuntimeEnvForTesting,
  setRuntimeEnvForTesting,
} from "../src/config/env.js";
import type { BackupRunnerConfig, BackupTarget } from "../src/config/types.js";
import {
  restoreLocalBackupArtifact,
  runLocalBackupJob,
} from "../src/core/backup-job.js";
import type { EncryptionAdapter } from "../src/core/ports.js";
import { fakeDumper } from "../src/dumpers/fake.js";
import {
  createAgeEncryptionAdapter,
  type AgeProcessRunner,
} from "../src/encryption/age.js";
import { getExternalStorageEncryptionIssue } from "../src/encryption/policy.js";
import { createLocalStorageAdapter } from "../src/storage/local.js";

const localAgeTarget: BackupTarget = {
  id: "local-age",
  enabled: true,
  dumper: {
    type: "fake",
    bytes: "encrypted dump",
  },
  storage: {
    type: "local",
    rootPath: mkdtempSync(path.join(tmpdir(), "ops-backup-runner-age-")),
  },
  encryption: {
    type: "age",
    recipientEnv: "BACKUP_AGE_RECIPIENT",
    identityPathEnv: "BACKUP_AGE_IDENTITY_PATH",
  },
};

const ageConfig: BackupRunnerConfig = {
  version: 1,
  targets: [localAgeTarget],
};

describe("encryption adapters", () => {
  afterEach(() => {
    resetRuntimeEnvForTesting();
  });

  it("encrypts artifact bytes after gzip and restores by decrypting before gunzip", () => {
    const encryption: EncryptionAdapter = {
      type: "age",
      encrypt(bytes): Buffer {
        return Buffer.concat([Buffer.from("age:"), bytes]);
      },
      decrypt(bytes): Buffer {
        return bytes.subarray("age:".length);
      },
    };
    const storage = createLocalStorageAdapter(localAgeTarget);

    const result = runLocalBackupJob(
      localAgeTarget,
      fakeDumper,
      storage,
      encryption
    );
    const artifact = storage.readArtifact(result.manifest);

    expect(result.manifest.artifact.encryption).toBe("age");
    expect(artifact.subarray(0, 4).toString("utf8")).toBe("age:");
    expect(gunzipSync(artifact.subarray(4)).toString("utf8")).toBe(
      "encrypted dump"
    );
    expect(
      restoreLocalBackupArtifact(artifact, encryption).toString("utf8")
    ).toBe("encrypted dump");
  });

  it("calls age encrypt and decrypt with env-resolved recipient and identity", () => {
    setRuntimeEnvForTesting({
      BACKUP_AGE_RECIPIENT: "age1example",
      BACKUP_AGE_IDENTITY_PATH: "/secure/identity.txt",
    });

    const calls: { command: string; args: string[]; input: string }[] = [];
    const runner: AgeProcessRunner = (command, args, input) => {
      calls.push({ command, args, input: input.toString("utf8") });
      return {
        status: 0,
        stdout: Buffer.from(`out:${input.toString("utf8")}`),
        stderr: "",
      };
    };

    const adapter = createAgeEncryptionAdapter(
      ageConfig,
      localAgeTarget,
      runner
    );

    expect(adapter.encrypt(Buffer.from("plain")).toString("utf8")).toBe(
      "out:plain"
    );
    expect(adapter.decrypt(Buffer.from("cipher")).toString("utf8")).toBe(
      "out:cipher"
    );
    expect(calls).toEqual([
      {
        command: "age",
        args: ["--encrypt", "--recipient", "age1example"],
        input: "plain",
      },
      {
        command: "age",
        args: ["--decrypt", "--identity", "/secure/identity.txt"],
        input: "cipher",
      },
    ]);
  });

  it("fails clearly when restore identity is missing", () => {
    setRuntimeEnvForTesting({
      BACKUP_AGE_RECIPIENT: "age1example",
    });

    const adapter = createAgeEncryptionAdapter(
      ageConfig,
      localAgeTarget,
      () => ({
        status: 0,
        stdout: Buffer.from("unused"),
        stderr: "",
      })
    );

    expect(() => adapter.decrypt(Buffer.from("cipher"))).toThrow(
      "Missing required environment variable BACKUP_AGE_IDENTITY_PATH"
    );
  });

  it("blocks none encryption for external storage unless explicitly allowed", () => {
    const externalTarget: BackupTarget = {
      ...localAgeTarget,
      id: "external-unsafe",
      storage: {
        type: "s3",
        endpoint: "https://example-account-id.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "unsafe-backups",
      },
      encryption: {
        type: "none",
      },
    };
    const config: BackupRunnerConfig = {
      version: 1,
      targets: [externalTarget],
    };

    expect(getExternalStorageEncryptionIssue(config, externalTarget)).toContain(
      "external s3 storage with encryption: none"
    );
    expect(runUnsafeExternalDoctorConfig().ok).toBe(false);
  });

  it("allows explicit unsafe external none encryption only when configured", () => {
    const externalTarget: BackupTarget = {
      ...localAgeTarget,
      id: "external-test",
      storage: {
        type: "s3",
        endpoint: "https://example-account-id.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "unsafe-backups",
      },
      encryption: {
        type: "none",
        allowUnsafeExternal: true,
      },
    };
    const config: BackupRunnerConfig = {
      version: 1,
      targets: [externalTarget],
    };

    expect(
      getExternalStorageEncryptionIssue(config, externalTarget)
    ).toBeUndefined();
  });
});

const runUnsafeExternalDoctorConfig = () => {
  const configPath = path.join(
    mkdtempSync(path.join(tmpdir(), "ops-backup-runner-doctor-")),
    "targets.yaml"
  );
  const yaml = [
    "version: 1",
    "targets:",
    "  - id: external-unsafe",
    "    enabled: true",
    "    dumper:",
    "      type: fake",
    "      bytes: dump",
    "    storage:",
    "      type: s3",
    "      endpoint: https://example-account-id.r2.cloudflarestorage.com",
    "      region: auto",
    "      bucket: unsafe-backups",
    "    encryption:",
    "      type: none",
  ].join("\n");

  writeFileSync(configPath, yaml, "utf8");
  return runDoctor(configPath);
};
