import type { BackupRunnerConfig, BackupTarget } from "../config/types.js";

export const getEffectiveNotificationsConfig = (
  config: BackupRunnerConfig,
  target: BackupTarget
) => target.notifications ?? config.defaults?.notifications;

export const shouldNotifyBackupFailure = (
  config: BackupRunnerConfig,
  target: BackupTarget
): boolean => {
  const telegram = getEffectiveNotificationsConfig(config, target)?.telegram;
  return telegram?.enabled === true && telegram.onFailure;
};
