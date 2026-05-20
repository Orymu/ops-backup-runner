import { gzipSync, gunzipSync } from "node:zlib";

import type { BackupTarget } from "../config/types.js";
import { createBackupId, sha256Hex } from "./artifact.js";
import type { BackupManifest } from "./manifest.js";
import type { Dumper, EncryptionAdapter, StorageAdapter } from "./ports.js";
import { createTempWorkspace } from "./temp-workspace.js";
import { noneEncryptionAdapter } from "../encryption/none.js";

export interface BackupJobResult {
  manifest: BackupManifest;
  tempWorkspaceCleaned: boolean;
}

export const runLocalBackupJob = (
  target: BackupTarget,
  dumper: Dumper<BackupTarget>,
  storage: StorageAdapter,
  encryption: EncryptionAdapter = noneEncryptionAdapter
): BackupJobResult => {
  const workspace = createTempWorkspace();

  try {
    const dump = dumper.dump(target);
    const compressed = gzipSync(dump.bytes);
    const encrypted = encryption.encrypt(compressed);
    const backupId = createBackupId(target.id);
    const extension = `${dump.extension}.gz`;
    const stored = storage.writeArtifact({
      targetId: target.id,
      backupId,
      artifactBytes: encrypted,
      extension,
    });

    const manifest: BackupManifest = {
      version: 1,
      backupId,
      targetId: target.id,
      createdAt: new Date().toISOString(),
      artifact: {
        key: stored.artifactKey,
        sizeBytes: stored.sizeBytes,
        sha256: sha256Hex(encrypted),
        compression: "gzip",
        encryption: encryption.type,
      },
      storage: {
        type: "local",
        artifactKey: stored.artifactKey,
        manifestKey: stored.manifestKey,
      },
    };

    storage.writeManifest(manifest);
    workspace.cleanup();

    return {
      manifest,
      tempWorkspaceCleaned: true,
    };
  } finally {
    workspace.cleanup();
  }
};

export const restoreLocalBackupArtifact = (
  artifactBytes: Buffer,
  encryption: EncryptionAdapter = noneEncryptionAdapter
): Buffer => gunzipSync(encryption.decrypt(artifactBytes));
