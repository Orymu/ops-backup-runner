import { describe, expect, it } from "vitest";

import type { BackupTarget } from "../src/config/types.js";
import type { BackupManifest } from "../src/core/manifest.js";
import {
  buildS3ArtifactKey,
  buildS3ManifestKey,
  buildS3ManifestPrefix,
  createS3StorageAdapter,
  type S3LikeClient,
} from "../src/storage/s3.js";

const s3Target = {
  id: "maintana",
  enabled: true,
  dumper: {
    type: "fake",
    bytes: "dump",
  },
  storage: {
    type: "s3",
    endpoint: "https://example-account-id.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "maintana-backups",
    prefix: "production/postgres",
    accessKeyIdEnv: "MAINTANA_BACKUP_R2_ACCESS_KEY_ID",
    secretAccessKeyEnv: "MAINTANA_BACKUP_R2_SECRET_ACCESS_KEY",
  },
  encryption: {
    type: "none",
  },
} satisfies BackupTarget;

const manifest: BackupManifest = {
  version: 1,
  backupId: "maintana-2026-05-19T08-21-00Z",
  targetId: "maintana",
  createdAt: "2026-05-19T01:21:00.000Z",
  artifact: {
    key: "production/postgres/maintana/artifacts/maintana-2026-05-19T08-21-00Z.dump.gz",
    sizeBytes: 12,
    sha256: "a".repeat(64),
    compression: "gzip",
    encryption: "none",
  },
  storage: {
    type: "s3",
    artifactKey:
      "production/postgres/maintana/artifacts/maintana-2026-05-19T08-21-00Z.dump.gz",
    manifestKey:
      "production/postgres/maintana/manifests/maintana-2026-05-19T08-21-00Z.json",
  },
};

class MockS3Client implements S3LikeClient {
  public readonly commands: unknown[] = [];
  private readonly objects = new Map<string, Buffer>();

  async send(command: unknown): Promise<unknown> {
    await Promise.resolve();
    this.commands.push(command);
    const input = getCommandInput(command);
    const name = getCommandName(command);

    if (name === "PutObjectCommand") {
      const body = input["Body"];
      if (!Buffer.isBuffer(body)) throw new Error("expected buffer body");
      this.objects.set(String(input["Key"]), body);
      return {};
    }

    if (name === "HeadObjectCommand") {
      const key = String(input["Key"]);
      return {
        ContentLength: this.objects.get(key)?.byteLength ?? 0,
        Metadata: {
          checked: "true",
        },
      };
    }

    if (name === "ListObjectsV2Command") {
      const prefix = String(input["Prefix"]);
      return {
        Contents: [...this.objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((Key) => ({ Key })),
      };
    }

    if (name === "GetObjectCommand") {
      const key = String(input["Key"]);
      return {
        Body: this.objects.get(key) ?? Buffer.alloc(0),
      };
    }

    if (name === "DeleteObjectCommand") {
      this.objects.delete(String(input["Key"]));
      return {};
    }

    throw new Error(`Unhandled command ${name}`);
  }
}

const getCommandName = (command: unknown): string => {
  if (
    command !== null &&
    typeof command === "object" &&
    "constructor" in command &&
    typeof command.constructor === "function"
  ) {
    return command.constructor.name;
  }

  return "UnknownCommand";
};

const getCommandInput = (command: unknown): Record<string, unknown> => {
  if (command !== null && typeof command === "object" && "input" in command) {
    return command.input as Record<string, unknown>;
  }

  throw new Error("command did not expose input");
};

describe("s3 storage adapter", () => {
  it("builds prefixed artifact and manifest keys", () => {
    expect(buildS3ArtifactKey(s3Target, "backup-1", "dump.gz")).toBe(
      "production/postgres/maintana/artifacts/backup-1.dump.gz"
    );
    expect(buildS3ManifestKey(s3Target, "backup-1")).toBe(
      "production/postgres/maintana/manifests/backup-1.json"
    );
    expect(buildS3ManifestPrefix(s3Target)).toBe(
      "production/postgres/maintana/manifests/"
    );
  });

  it("uploads artifact and verifies it with head object", async () => {
    const client = new MockS3Client();
    const adapter = createS3StorageAdapter(s3Target, client);

    const stored = await adapter.writeArtifact({
      targetId: "maintana",
      backupId: manifest.backupId,
      artifactBytes: Buffer.from("hello"),
      extension: "dump.gz",
    });

    expect(stored).toEqual({
      artifactKey:
        "production/postgres/maintana/artifacts/maintana-2026-05-19T08-21-00Z.dump.gz",
      manifestKey:
        "production/postgres/maintana/manifests/maintana-2026-05-19T08-21-00Z.json",
      sizeBytes: 5,
    });
    expect(client.commands.map(getCommandName)).toEqual([
      "PutObjectCommand",
      "HeadObjectCommand",
    ]);
  });

  it("writes and lists manifests", async () => {
    const client = new MockS3Client();
    const adapter = createS3StorageAdapter(s3Target, client);

    await adapter.writeManifest(manifest);
    const manifests = await adapter.listManifests("maintana");

    expect(manifests).toEqual([manifest]);
    expect(client.commands.map(getCommandName)).toEqual([
      "PutObjectCommand",
      "HeadObjectCommand",
      "ListObjectsV2Command",
      "GetObjectCommand",
    ]);
  });

  it("downloads and deletes objects", async () => {
    const client = new MockS3Client();
    const adapter = createS3StorageAdapter(s3Target, client);

    await adapter.writeArtifact({
      targetId: "maintana",
      backupId: manifest.backupId,
      artifactBytes: Buffer.from("archive"),
      extension: "dump.gz",
    });

    await expect(adapter.readArtifact(manifest)).resolves.toEqual(
      Buffer.from("archive")
    );
    const deletion = adapter.deleteObject(manifest.storage.artifactKey);
    await deletion;
    await expect(adapter.readArtifact(manifest)).resolves.toEqual(
      Buffer.alloc(0)
    );
  });

  it("supports same bucket with different prefixes", () => {
    const kevlyTarget = {
      ...s3Target,
      id: "kevly",
      storage: {
        ...s3Target.storage,
        bucket: "shared-backups",
        prefix: "kevly/prod",
      },
    } satisfies BackupTarget;

    expect(buildS3ArtifactKey(kevlyTarget, "backup-1", "dump.gz")).toBe(
      "kevly/prod/kevly/artifacts/backup-1.dump.gz"
    );
  });
});
