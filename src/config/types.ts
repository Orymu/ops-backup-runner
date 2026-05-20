import type { z } from "zod";

import type { backupRunnerConfigSchema } from "./schema.js";

export type BackupRunnerConfig = z.infer<typeof backupRunnerConfigSchema>;
export type BackupTarget = BackupRunnerConfig["targets"][number];
export type BackupTargetId = BackupTarget["id"];
export type BackupRunnerDefaults = NonNullable<BackupRunnerConfig["defaults"]>;

export type ConfigLoadResult =
  | {
      ok: true;
      config: BackupRunnerConfig;
    }
  | {
      ok: false;
      message: string;
      issues: string[];
    };
