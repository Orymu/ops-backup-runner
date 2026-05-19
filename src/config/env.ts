import type { BackupRunnerConfig, BackupTarget } from "./types.js";

export interface EnvReference {
  name: string;
  owner: string;
  requiredForEnabledTarget: boolean;
}

export interface EnvResolutionIssue {
  envName: string;
  owner: string;
  message: string;
}

export interface EnvResolutionResult {
  ok: boolean;
  issues: EnvResolutionIssue[];
}

let runtimeEnv: Record<string, string | undefined> = process.env;

export const getRuntimeEnv = (): Record<string, string | undefined> =>
  runtimeEnv;

export const setRuntimeEnvForTesting = (
  env: Record<string, string | undefined>
): void => {
  runtimeEnv = env;
};

export const resetRuntimeEnvForTesting = (): void => {
  runtimeEnv = process.env;
};

const addEnvReference = (
  references: EnvReference[],
  name: string | undefined,
  owner: string,
  requiredForEnabledTarget: boolean
): void => {
  if (name === undefined) return;
  references.push({ name, owner, requiredForEnabledTarget });
};

export const getTargetEnvReferences = (
  config: BackupRunnerConfig,
  target: BackupTarget
): EnvReference[] => {
  const references: EnvReference[] = [];
  const encryption = target.encryption ?? config.defaults?.encryption;
  const notifications = target.notifications ?? config.defaults?.notifications;

  if (target.dumper.type === "postgresDocker") {
    addEnvReference(
      references,
      target.dumper.passwordEnv,
      `${target.id}.dumper.passwordEnv`,
      false
    );
  }

  if (target.storage.type === "s3") {
    addEnvReference(
      references,
      target.storage.accessKeyIdEnv,
      `${target.id}.storage.accessKeyIdEnv`,
      true
    );
    addEnvReference(
      references,
      target.storage.secretAccessKeyEnv,
      `${target.id}.storage.secretAccessKeyEnv`,
      true
    );
  }

  if (encryption?.type === "age") {
    addEnvReference(
      references,
      encryption.recipientEnv,
      `${target.id}.encryption.recipientEnv`,
      true
    );
  }

  if (notifications?.telegram?.enabled === true) {
    addEnvReference(
      references,
      notifications.telegram.botTokenEnv,
      `${target.id}.notifications.telegram.botTokenEnv`,
      true
    );
    addEnvReference(
      references,
      notifications.telegram.chatIdEnv,
      `${target.id}.notifications.telegram.chatIdEnv`,
      true
    );
  }

  return references;
};

export const resolveTargetEnvReferences = (
  config: BackupRunnerConfig,
  target: BackupTarget,
  env: Record<string, string | undefined> = getRuntimeEnv()
): EnvResolutionResult => {
  if (!target.enabled) {
    return { ok: true, issues: [] };
  }

  const notifications = target.notifications ?? config.defaults?.notifications;
  const telegram = notifications?.telegram;
  const notificationConfigIssues: EnvResolutionIssue[] =
    telegram?.enabled === true
      ? [
          ...(telegram.botTokenEnv === undefined
            ? [
                {
                  envName: "botTokenEnv",
                  owner: `${target.id}.notifications.telegram.botTokenEnv`,
                  message: `${target.id}.notifications.telegram.botTokenEnv is required when Telegram notifications are enabled`,
                },
              ]
            : []),
          ...(telegram.chatIdEnv === undefined
            ? [
                {
                  envName: "chatIdEnv",
                  owner: `${target.id}.notifications.telegram.chatIdEnv`,
                  message: `${target.id}.notifications.telegram.chatIdEnv is required when Telegram notifications are enabled`,
                },
              ]
            : []),
        ]
      : [];

  const issues = getTargetEnvReferences(config, target)
    .filter((reference) => reference.requiredForEnabledTarget)
    .filter((reference) => env[reference.name] === undefined)
    .map((reference) => ({
      envName: reference.name,
      owner: reference.owner,
      message: `Missing required environment variable ${reference.name} for ${reference.owner}`,
    }));

  return {
    ok: notificationConfigIssues.length === 0 && issues.length === 0,
    issues: [...notificationConfigIssues, ...issues],
  };
};
