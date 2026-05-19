import { z } from "zod";

export const backupManifestSchema = z
  .object({
    version: z.literal(1),
    backupId: z.string().min(1),
    targetId: z.string().min(1),
    createdAt: z.iso.datetime(),
    artifact: z
      .object({
        key: z.string().min(1),
        sizeBytes: z.number().int().nonnegative(),
        sha256: z.string().length(64),
        compression: z.literal("gzip"),
        encryption: z.literal("none"),
      })
      .strict(),
    storage: z
      .object({
        type: z.enum(["local", "s3"]),
        artifactKey: z.string().min(1),
        manifestKey: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type BackupManifest = z.infer<typeof backupManifestSchema>;
