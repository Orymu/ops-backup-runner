import {
  unlinkSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { BackupTarget } from "../config/types.js";
import { backupManifestSchema, type BackupManifest } from "../core/manifest.js";
import type { StorageAdapter, StoredArtifact } from "../core/ports.js";

const getLocalRoot = (target: BackupTarget): string => {
  if (target.storage.type !== "local") {
    throw new Error(
      `Unsupported storage for local pipeline: ${target.storage.type}`
    );
  }

  return target.storage.rootPath;
};

const getTargetRoot = (root: string, targetId: string): string =>
  path.join(root, targetId);

const walkFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath);
    if (entry.isFile()) return [fullPath];
    return [];
  });
};

export const createLocalStorageAdapter = (
  target: BackupTarget
): StorageAdapter => {
  const root = getLocalRoot(target);

  return {
    writeArtifact(params): StoredArtifact {
      const targetRoot = getTargetRoot(root, params.targetId);
      const artifactsRoot = path.join(targetRoot, "artifacts");
      const manifestsRoot = path.join(targetRoot, "manifests");
      mkdirSync(artifactsRoot, { recursive: true });
      mkdirSync(manifestsRoot, { recursive: true });

      const artifactFile = `${params.backupId}.${params.extension}`;
      const artifactPath = path.join(artifactsRoot, artifactFile);
      writeFileSync(artifactPath, params.artifactBytes);

      return {
        artifactKey: path
          .relative(root, artifactPath)
          .split(path.sep)
          .join("/"),
        manifestKey: `${params.targetId}/manifests/${params.backupId}.json`,
        sizeBytes: params.artifactBytes.byteLength,
      };
    },

    writeManifest(manifest): void {
      const manifestPath = path.join(root, manifest.storage.manifestKey);
      mkdirSync(path.dirname(manifestPath), { recursive: true });
      writeFileSync(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      );
    },

    listManifests(targetId): BackupManifest[] {
      const manifestsRoot = path.join(
        getTargetRoot(root, targetId),
        "manifests"
      );
      if (!existsSync(manifestsRoot)) return [];

      return readdirSync(manifestsRoot)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => {
          const raw = readFileSync(path.join(manifestsRoot, file), "utf8");
          return backupManifestSchema.parse(JSON.parse(raw));
        });
    },

    readArtifact(manifest): Buffer {
      return readFileSync(path.join(root, manifest.storage.artifactKey));
    },

    deleteObject(key): void {
      const objectPath = path.join(root, key);
      if (existsSync(objectPath)) {
        unlinkSync(objectPath);
      }
    },

    listObjectKeys(targetId): string[] {
      const targetRoot = getTargetRoot(root, targetId);
      return walkFiles(targetRoot)
        .map((file) => path.relative(root, file).split(path.sep).join("/"))
        .sort();
    },
  };
};
