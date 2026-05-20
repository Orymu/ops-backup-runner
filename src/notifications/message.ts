import { hostname } from "node:os";

import type { BackupFailureNotification } from "../core/notifications.js";

const sensitivePattern =
  /(password|token|secret|access[_-]?key|credential)(=|:)\S+/giu;

const formatJakartaTime = (date: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  })
    .format(date)
    .replace(",", "");

export const redactSensitiveText = (
  text: string,
  explicitSecrets: string[] = []
): string => {
  const patternRedacted = text.replace(sensitivePattern, "$1$2[REDACTED]");

  return explicitSecrets
    .filter((secret) => secret.length > 0)
    .reduce(
      (output, secret) => output.split(secret).join("[REDACTED]"),
      patternRedacted
    );
};

export const getServerName = (): string => hostname();

export const formatBackupFailureMessage = (
  event: BackupFailureNotification
): string =>
  [
    "[Backup Failed]",
    `Target: ${event.targetId}`,
    `Stage: ${event.stage}`,
    `Time: ${formatJakartaTime(event.occurredAt)} WIB`,
    `Error: ${redactSensitiveText(event.error)}`,
    `Server: ${event.server}`,
  ].join("\n");
