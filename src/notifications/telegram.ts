import {
  defaultProcessRunner,
  type ProcessRunner,
} from "../core/process-runner.js";
import type {
  BackupFailureNotification,
  FailureNotifier,
  NotificationResult,
} from "../core/notifications.js";
import { formatBackupFailureMessage, redactSensitiveText } from "./message.js";

export interface TelegramNotifierConfig {
  botToken: string;
  chatId: string;
  runner?: ProcessRunner;
}

let defaultTelegramProcessRunner: ProcessRunner = defaultProcessRunner;

export const setTelegramProcessRunnerForTesting = (
  runner: ProcessRunner
): void => {
  defaultTelegramProcessRunner = runner;
};

export const resetTelegramProcessRunnerForTesting = (): void => {
  defaultTelegramProcessRunner = defaultProcessRunner;
};

export const buildTelegramSendMessageArgs = (params: {
  botToken: string;
  chatId: string;
  text: string;
}): string[] => [
  "--fail",
  "--silent",
  "--show-error",
  "--request",
  "POST",
  `https://api.telegram.org/bot${params.botToken}/sendMessage`,
  "--header",
  "Content-Type: application/json",
  "--data",
  JSON.stringify({
    chat_id: params.chatId,
    text: params.text,
  }),
];

export const createTelegramNotifier = (
  config: TelegramNotifierConfig
): FailureNotifier => {
  if (config.botToken.length === 0) {
    throw new Error("Telegram bot token is required.");
  }
  if (config.chatId.length === 0) {
    throw new Error("Telegram chat id is required.");
  }

  const runner = config.runner ?? defaultTelegramProcessRunner;

  return {
    notifyFailure(event: BackupFailureNotification): NotificationResult {
      const result = runner(
        "curl",
        buildTelegramSendMessageArgs({
          botToken: config.botToken,
          chatId: config.chatId,
          text: formatBackupFailureMessage(event),
        })
      );

      if (result.status === 0) {
        return {
          ok: true,
          message: "Telegram failure notification sent.",
        };
      }

      const detail = redactSensitiveText(
        (result.error?.message ?? result.stderr.trim()) || "unknown error",
        [config.botToken]
      );

      return {
        ok: false,
        message: `Telegram failure notification failed: ${detail}`,
      };
    },
  };
};
