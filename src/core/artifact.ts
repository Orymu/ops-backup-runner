import { createHash } from "node:crypto";

export const createBackupId = (targetId: string, date = new Date()): string => {
  const timestamp = date
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/u, "Z");
  return `${targetId}-${timestamp}`;
};

export const sha256Hex = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
