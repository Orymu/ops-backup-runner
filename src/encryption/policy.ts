import type { BackupRunnerConfig, BackupTarget } from "../config/types.js";

export const getEffectiveEncryptionConfig = (
  config: BackupRunnerConfig,
  target: BackupTarget
) =>
  target.encryption ?? config.defaults?.encryption ?? { type: "none" as const };

export const getExternalStorageEncryptionIssue = (
  config: BackupRunnerConfig,
  target: BackupTarget
): string | undefined => {
  const encryption = getEffectiveEncryptionConfig(config, target);
  if (target.storage.type === "local") return undefined;
  if (encryption.type !== "none") return undefined;
  if (encryption.allowUnsafeExternal === true) return undefined;

  return `${target.id} uses external ${target.storage.type} storage with encryption: none. Use age encryption or set allowUnsafeExternal only for an explicit unsafe test target.`;
};
