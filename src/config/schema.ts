import { z } from "zod";

const targetIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/u, {
    message: "target id must use lowercase letters, numbers, and dashes only",
  });

const envNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Z][A-Z0-9_]*$/u, {
    message: "env references must use uppercase env var names",
  });

const retentionSchema = z
  .object({
    keepDaily: z.number().int().positive().optional(),
    keepWeekly: z.number().int().positive().optional(),
    keepMonthly: z.number().int().positive().optional(),
    maxAgeDays: z.number().int().positive().optional(),
    keepManual: z.array(z.string().min(1)).optional(),
  })
  .strict();

const postgresDockerDumperSchema = z
  .object({
    type: z.literal("postgresDocker"),
    container: z.string().min(1),
    database: z.string().min(1),
    username: z.string().min(1),
    passwordEnv: envNameSchema.optional(),
    format: z.literal("custom").default("custom"),
    dockerBinary: z.string().min(1).optional(),
    pgRestoreBinary: z.string().min(1).optional(),
  })
  .strict();

const fakeDumperSchema = z
  .object({
    type: z.literal("fake"),
    bytes: z.string().min(1).default("ops-backup-runner fake dump\n"),
  })
  .strict();

const dumperSchema = z.discriminatedUnion("type", [
  postgresDockerDumperSchema,
  fakeDumperSchema,
]);

const s3StorageSchema = z
  .object({
    type: z.literal("s3"),
    endpoint: z.url(),
    region: z.string().min(1),
    bucket: z.string().min(1),
    prefix: z.string().min(1).optional(),
    accessKeyIdEnv: envNameSchema.optional(),
    secretAccessKeyEnv: envNameSchema.optional(),
  })
  .strict();

const localStorageSchema = z
  .object({
    type: z.literal("local"),
    rootPath: z.string().min(1),
  })
  .strict();

const storageSchema = z.discriminatedUnion("type", [
  s3StorageSchema,
  localStorageSchema,
]);

const ageEncryptionSchema = z
  .object({
    type: z.literal("age"),
    recipientEnv: envNameSchema.optional(),
    identityPathEnv: envNameSchema.optional(),
    binary: z.string().min(1).optional(),
  })
  .strict();

const noneEncryptionSchema = z
  .object({
    type: z.literal("none"),
    allowUnsafeExternal: z.boolean().optional(),
  })
  .strict();

const encryptionSchema = z.discriminatedUnion("type", [
  ageEncryptionSchema,
  noneEncryptionSchema,
]);

const telegramNotificationSchema = z
  .object({
    enabled: z.boolean().default(false),
    onFailure: z.boolean().default(true),
    onSuccess: z.boolean().default(false),
    successCadence: z.enum(["daily", "weekly", "monthly"]).optional(),
    botTokenEnv: envNameSchema.optional(),
    chatIdEnv: envNameSchema.optional(),
  })
  .strict();

const notificationPolicySchema = z
  .object({
    telegram: telegramNotificationSchema.optional(),
  })
  .strict();

const targetSchema = z
  .object({
    id: targetIdSchema,
    enabled: z.boolean().default(true),
    description: z.string().min(1).optional(),
    dumper: dumperSchema,
    storage: storageSchema,
    retention: retentionSchema.optional(),
    encryption: encryptionSchema.optional(),
    notifications: notificationPolicySchema.optional(),
  })
  .strict();

export const backupRunnerConfigSchema = z
  .object({
    version: z.literal(1),
    defaults: z
      .object({
        encryption: encryptionSchema.optional(),
        retention: retentionSchema.optional(),
        notifications: notificationPolicySchema.optional(),
      })
      .strict()
      .optional(),
    targets: z
      .array(targetSchema)
      .min(1)
      .superRefine((targets, context) => {
        const seen = new Set<string>();
        for (const [index, target] of targets.entries()) {
          if (seen.has(target.id)) {
            context.addIssue({
              code: "custom",
              message: `duplicate target id: ${target.id}`,
              path: [index, "id"],
            });
          }
          seen.add(target.id);
        }
      }),
  })
  .strict();
