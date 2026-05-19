import { writeFileSync } from "node:fs";
import path from "node:path";

import type { BackupTarget } from "../config/types.js";
import {
  defaultProcessRunner,
  type ProcessRunner,
} from "../dumpers/postgres-docker.js";
import { sha256Hex } from "./artifact.js";
import { restoreLocalBackupArtifact } from "./backup-job.js";
import type { BackupManifest } from "./manifest.js";
import type { EncryptionAdapter } from "./ports.js";
import { createTempWorkspace } from "./temp-workspace.js";

export interface BackupVerificationResult {
  backupId: string;
  targetId: string;
  ok: boolean;
  checks: {
    checksum: boolean;
    restore: boolean;
    postgresRestoreList?: boolean;
  };
  issues: string[];
  tempWorkspaceCleaned: boolean;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runPostgresRestoreList = (
  target: BackupTarget,
  restoredBytes: Buffer,
  runner: ProcessRunner
): {
  ok: boolean;
  issue: string | undefined;
  tempWorkspaceCleaned: boolean;
} => {
  const workspace = createTempWorkspace();
  let ok = false;
  let issue: string | undefined;

  try {
    const dumpPath = path.join(workspace.path, `${target.id}.dump`);
    writeFileSync(dumpPath, restoredBytes);

    const pgRestoreBinary =
      target.dumper.type === "postgresDocker"
        ? (target.dumper.pgRestoreBinary ?? "pg_restore")
        : "pg_restore";
    const result = runner(pgRestoreBinary, ["--list", dumpPath]);
    if (result.status === 0) {
      ok = true;
    } else {
      const detail =
        (result.error?.message ?? result.stderr.trim()) || "unknown error";
      issue = `PostgreSQL restore-list verification failed for ${target.id}: ${detail}`;
    }
  } finally {
    workspace.cleanup();
  }

  return {
    ok,
    issue,
    tempWorkspaceCleaned: true,
  };
};

export const verifyBackupArtifact = (params: {
  target: BackupTarget;
  manifest: BackupManifest;
  artifactBytes: Buffer;
  encryption: EncryptionAdapter;
  processRunner?: ProcessRunner;
}): BackupVerificationResult => {
  const checksumOk =
    sha256Hex(params.artifactBytes) === params.manifest.artifact.sha256;
  const issues: string[] = [];
  let restoreOk = false;
  let postgresRestoreListOk: boolean | undefined;
  let tempWorkspaceCleaned = true;

  if (!checksumOk) {
    issues.push(`Checksum mismatch for backup ${params.manifest.backupId}.`);
  } else {
    try {
      const restoredBytes = restoreLocalBackupArtifact(
        params.artifactBytes,
        params.encryption
      );
      restoreOk = true;

      if (params.target.dumper.type === "postgresDocker") {
        const postgresResult = runPostgresRestoreList(
          params.target,
          restoredBytes,
          params.processRunner ?? defaultProcessRunner
        );
        postgresRestoreListOk = postgresResult.ok;
        tempWorkspaceCleaned = postgresResult.tempWorkspaceCleaned;
        if (postgresResult.issue !== undefined) {
          issues.push(postgresResult.issue);
        }
      }
    } catch (error) {
      issues.push(
        `Artifact restore verification failed for ${params.manifest.backupId}: ${errorMessage(
          error
        )}`
      );
    }
  }

  const checks = {
    checksum: checksumOk,
    restore: restoreOk,
    ...(postgresRestoreListOk === undefined
      ? {}
      : { postgresRestoreList: postgresRestoreListOk }),
  };

  return {
    backupId: params.manifest.backupId,
    targetId: params.manifest.targetId,
    ok: issues.length === 0,
    checks,
    issues,
    tempWorkspaceCleaned,
  };
};
