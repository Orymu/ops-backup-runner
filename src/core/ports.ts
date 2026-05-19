import type { BackupManifest } from "./manifest.js";

export interface DumpArtifact {
  bytes: Buffer;
  extension: string;
}

export interface Dumper<TTarget> {
  dump(target: TTarget): DumpArtifact;
}

export interface StoredArtifact {
  artifactKey: string;
  manifestKey: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  writeArtifact(params: {
    targetId: string;
    backupId: string;
    artifactBytes: Buffer;
    extension: string;
  }): StoredArtifact;
  writeManifest(manifest: BackupManifest): void;
  listManifests(targetId: string): BackupManifest[];
  readArtifact(manifest: BackupManifest): Buffer;
}
