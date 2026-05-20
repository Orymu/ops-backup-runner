import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type DeleteObjectCommandInput,
  type GetObjectCommandInput,
  type HeadObjectCommandInput,
  type ListObjectsV2CommandInput,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";

import { getRuntimeEnv } from "../config/env.js";
import type { BackupTarget } from "../config/types.js";
import { backupManifestSchema, type BackupManifest } from "../core/manifest.js";
import type {
  StorageAdapter,
  StoredArtifact,
  StoredObjectHead,
} from "../core/ports.js";

export interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

interface ByteArrayTransformBody {
  transformToByteArray(): Promise<Uint8Array>;
}

export type S3StorageAdapter = Omit<
  StorageAdapter,
  | "writeArtifact"
  | "writeManifest"
  | "listManifests"
  | "readArtifact"
  | "deleteObject"
  | "headObject"
> & {
  writeArtifact(params: {
    targetId: string;
    backupId: string;
    artifactBytes: Buffer;
    extension: string;
  }): Promise<StoredArtifact>;
  writeManifest(manifest: BackupManifest): Promise<void>;
  listManifests(targetId: string): Promise<BackupManifest[]>;
  readArtifact(manifest: BackupManifest): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  headObject(key: string): Promise<StoredObjectHead>;
};

const getS3StorageConfig = (target: BackupTarget) => {
  if (target.storage.type !== "s3") {
    throw new Error(
      `Unsupported storage for S3 adapter: ${target.storage.type}`
    );
  }

  return target.storage;
};

const resolveRequiredEnv = (
  name: string | undefined,
  owner: string
): string => {
  if (name === undefined) {
    throw new Error(`Missing env reference for ${owner}`);
  }

  const value = getRuntimeEnv()[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name} for ${owner}`
    );
  }

  return value;
};

const joinKey = (...parts: string[]): string =>
  parts
    .filter((part) => part.length > 0)
    .join("/")
    .replaceAll(/\/+/gu, "/");

const getPrefix = (target: BackupTarget): string => {
  const storage = getS3StorageConfig(target);
  return storage.prefix ?? "";
};

export const buildS3ArtifactKey = (
  target: BackupTarget,
  backupId: string,
  extension: string
): string =>
  joinKey(
    getPrefix(target),
    target.id,
    "artifacts",
    `${backupId}.${extension}`
  );

export const buildS3ManifestKey = (
  target: BackupTarget,
  backupId: string
): string =>
  joinKey(getPrefix(target), target.id, "manifests", `${backupId}.json`);

export const buildS3ManifestPrefix = (target: BackupTarget): string =>
  joinKey(getPrefix(target), target.id, "manifests") + "/";

export const createS3ClientForTarget = (target: BackupTarget): S3Client => {
  const storage = getS3StorageConfig(target);
  const accessKeyId = resolveRequiredEnv(
    storage.accessKeyIdEnv,
    `${target.id}.storage.accessKeyIdEnv`
  );
  const secretAccessKey = resolveRequiredEnv(
    storage.secretAccessKeyEnv,
    `${target.id}.storage.secretAccessKeyEnv`
  );

  return new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });
};

const bodyToBuffer = async (body: unknown): Promise<Buffer> => {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (isByteArrayTransformBody(body)) {
    const byteArray = await body.transformToByteArray();
    return Buffer.from(byteArray);
  }

  throw new Error("Unsupported S3 body type");
};

const isByteArrayTransformBody = (
  body: unknown
): body is ByteArrayTransformBody =>
  body !== null &&
  typeof body === "object" &&
  "transformToByteArray" in body &&
  typeof body.transformToByteArray === "function";

const getObjectKeys = (response: unknown): string[] => {
  if (response === null || typeof response !== "object") return [];
  if (!("Contents" in response) || !Array.isArray(response.Contents)) return [];

  const contents = response.Contents as unknown[];

  return contents.flatMap((item): string[] => {
    if (
      item !== null &&
      typeof item === "object" &&
      "Key" in item &&
      typeof item.Key === "string"
    ) {
      return [item.Key];
    }
    return [];
  });
};

const getContentLength = (response: unknown): number => {
  if (
    response !== null &&
    typeof response === "object" &&
    "ContentLength" in response &&
    typeof response.ContentLength === "number"
  ) {
    return response.ContentLength;
  }

  return 0;
};

const getMetadata = (response: unknown): Record<string, string> => {
  if (
    response !== null &&
    typeof response === "object" &&
    "Metadata" in response &&
    response.Metadata !== null &&
    typeof response.Metadata === "object"
  ) {
    return Object.fromEntries(
      Object.entries(response.Metadata).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  }

  return {};
};

const readObjectBody = async (response: unknown): Promise<Buffer> => {
  if (response !== null && typeof response === "object" && "Body" in response) {
    return bodyToBuffer(response.Body);
  }

  throw new Error("S3 get object response did not include a body");
};

export const createS3StorageAdapter = (
  target: BackupTarget,
  client: S3LikeClient = createS3ClientForTarget(target)
): S3StorageAdapter => {
  const storage = getS3StorageConfig(target);

  const send = async (command: unknown): Promise<unknown> =>
    client.send(command);

  const headObject = async (key: string): Promise<StoredObjectHead> => {
    const response = await send(
      new HeadObjectCommand({
        Bucket: storage.bucket,
        Key: key,
      } satisfies HeadObjectCommandInput)
    );

    return {
      key,
      sizeBytes: getContentLength(response),
      metadata: getMetadata(response),
    };
  };

  return {
    async writeArtifact(params): Promise<StoredArtifact> {
      const artifactKey = buildS3ArtifactKey(
        target,
        params.backupId,
        params.extension
      );
      const manifestKey = buildS3ManifestKey(target, params.backupId);
      const metadata = {
        "target-id": params.targetId,
        "backup-id": params.backupId,
      };

      await send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: artifactKey,
          Body: params.artifactBytes,
          Metadata: metadata,
        } satisfies PutObjectCommandInput)
      );

      const head = await headObject(artifactKey);
      if (head.sizeBytes !== params.artifactBytes.byteLength) {
        throw new Error(
          `S3 upload verification failed for ${artifactKey}: expected ${String(
            params.artifactBytes.byteLength
          )} bytes, got ${String(head.sizeBytes)} bytes`
        );
      }

      return {
        artifactKey,
        manifestKey,
        sizeBytes: params.artifactBytes.byteLength,
      };
    },

    async writeManifest(manifest): Promise<void> {
      const body = Buffer.from(
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      );
      await send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: manifest.storage.manifestKey,
          Body: body,
          Metadata: {
            "target-id": manifest.targetId,
            "backup-id": manifest.backupId,
            "created-at": manifest.createdAt,
            sha256: manifest.artifact.sha256,
          },
        } satisfies PutObjectCommandInput)
      );

      const head = await headObject(manifest.storage.manifestKey);
      if (head.sizeBytes !== body.byteLength) {
        throw new Error(
          `S3 manifest upload verification failed for ${manifest.storage.manifestKey}`
        );
      }
    },

    async listManifests(targetId): Promise<BackupManifest[]> {
      const response = await send(
        new ListObjectsV2Command({
          Bucket: storage.bucket,
          Prefix: buildS3ManifestPrefix({
            ...target,
            id: targetId,
          }),
        } satisfies ListObjectsV2CommandInput)
      );

      const manifests: BackupManifest[] = [];
      for (const key of getObjectKeys(response)) {
        const object = await send(
          new GetObjectCommand({
            Bucket: storage.bucket,
            Key: key,
          } satisfies GetObjectCommandInput)
        );
        manifests.push(
          backupManifestSchema.parse(
            JSON.parse((await readObjectBody(object)).toString("utf8"))
          )
        );
      }

      return manifests;
    },

    async readArtifact(manifest): Promise<Buffer> {
      const response = await send(
        new GetObjectCommand({
          Bucket: storage.bucket,
          Key: manifest.storage.artifactKey,
        } satisfies GetObjectCommandInput)
      );
      return readObjectBody(response);
    },

    async deleteObject(key): Promise<void> {
      await send(
        new DeleteObjectCommand({
          Bucket: storage.bucket,
          Key: key,
        } satisfies DeleteObjectCommandInput)
      );
    },

    headObject,
  };
};
