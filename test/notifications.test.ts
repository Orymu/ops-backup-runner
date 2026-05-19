import { describe, expect, it } from "vitest";

import { formatBackupFailureMessage } from "../src/notifications/message.js";
import {
  buildTelegramSendMessageArgs,
  createTelegramNotifier,
} from "../src/notifications/telegram.js";
import type { ProcessRunner } from "../src/core/process-runner.js";

describe("notifications", () => {
  it("formats secret-safe backup failure messages", () => {
    expect(
      formatBackupFailureMessage({
        targetId: "maintana",
        stage: "upload",
        occurredAt: new Date("2026-05-18T19:00:00.000Z"),
        error: "AccessDenied token=secret-token",
        server: "orymu-droplet",
      })
    ).toBe(
      [
        "[Backup Failed]",
        "Target: maintana",
        "Stage: upload",
        "Time: 19 May 2026 02:00 WIB",
        "Error: AccessDenied token=[REDACTED]",
        "Server: orymu-droplet",
      ].join("\n")
    );
  });

  it("builds Telegram sendMessage requests without leaking details into feature code", () => {
    const args = buildTelegramSendMessageArgs({
      botToken: "bot-secret",
      chatId: "12345",
      text: "hello",
    });

    expect(args).toContain(
      "https://api.telegram.org/botbot-secret/sendMessage"
    );
    expect(args).toContain(
      JSON.stringify({
        chat_id: "12345",
        text: "hello",
      })
    );
  });

  it("returns typed Telegram send failures with token redaction", () => {
    const runner: ProcessRunner = () => ({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: "request failed for bot-secret",
    });

    const result = createTelegramNotifier({
      botToken: "bot-secret",
      chatId: "12345",
      runner,
    }).notifyFailure({
      targetId: "maintana",
      stage: "backup",
      occurredAt: new Date("2026-05-19T02:00:00.000Z"),
      error: "failed",
      server: "test-server",
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Telegram failure notification failed: request failed for [REDACTED]",
    });
  });
});
