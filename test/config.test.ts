import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDoctor } from "../src/commands/doctor.js";
import { resolveTargetEnvReferences } from "../src/config/env.js";
import { loadConfigFromFile } from "../src/config/loader.js";
import { redactConfigPreview } from "../src/config/redact.js";

const writeConfig = (content: string): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "ops-backup-runner-"));
  const file = path.join(directory, "targets.yaml");
  writeFileSync(file, content, "utf8");
  return file;
};

const validConfig = `
version: 1
defaults:
  encryption:
    type: age
    recipientEnv: BACKUP_AGE_RECIPIENT
targets:
  - id: maintana
    enabled: true
    dumper:
      type: postgresDocker
      container: maintana-postgres
      database: maintana
      username: maintana
      passwordEnv: MAINTANA_POSTGRES_PASSWORD
    storage:
      type: s3
      endpoint: https://example-account-id.r2.cloudflarestorage.com
      region: auto
      bucket: maintana-backups
      accessKeyIdEnv: MAINTANA_BACKUP_R2_ACCESS_KEY_ID
      secretAccessKeyEnv: MAINTANA_BACKUP_R2_SECRET_ACCESS_KEY
`;

describe("config foundation", () => {
  it("loads a valid YAML config", () => {
    const result = loadConfigFromFile(writeConfig(validConfig));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.targets[0]?.id).toBe("maintana");
      expect(result.config.targets[0]?.dumper.type).toBe("postgresDocker");
    }
  });

  it("rejects unknown dumper types", () => {
    const result = loadConfigFromFile(
      writeConfig(validConfig.replace("postgresDocker", "mongodbDocker"))
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join("\n")).toContain("postgresDocker");
    }
  });

  it("rejects duplicate target ids", () => {
    const result = loadConfigFromFile(
      writeConfig(`
version: 1
targets:
  - id: maintana
    dumper:
      type: postgresDocker
      container: one
      database: one
      username: one
    storage:
      type: s3
      endpoint: https://one.example.com
      region: auto
      bucket: one
  - id: maintana
    dumper:
      type: postgresDocker
      container: two
      database: two
      username: two
    storage:
      type: s3
      endpoint: https://two.example.com
      region: auto
      bucket: two
`)
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join("\n")).toContain(
        "duplicate target id: maintana"
      );
    }
  });

  it("reports missing env references for enabled targets", () => {
    const result = loadConfigFromFile(writeConfig(validConfig));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = result.config.targets[0];
    expect(target).toBeDefined();
    if (target === undefined) return;

    const envResult = resolveTargetEnvReferences(result.config, target, {});

    expect(envResult.ok).toBe(false);
    expect(envResult.issues.map((issue) => issue.envName)).toEqual([
      "MAINTANA_BACKUP_R2_ACCESS_KEY_ID",
      "MAINTANA_BACKUP_R2_SECRET_ACCESS_KEY",
      "BACKUP_AGE_RECIPIENT",
    ]);
  });

  it("requires Telegram env names and values when Telegram notifications are enabled", () => {
    const configPath = writeConfig(`
version: 1
targets:
  - id: local-demo
    enabled: true
    dumper:
      type: fake
      bytes: dump
    storage:
      type: local
      rootPath: /tmp/backups
    notifications:
      telegram:
        enabled: true
`);
    const result = loadConfigFromFile(configPath);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = result.config.targets[0];
    expect(target).toBeDefined();
    if (target === undefined) return;

    const envResult = resolveTargetEnvReferences(result.config, target, {});

    expect(envResult.ok).toBe(false);
    expect(envResult.issues.map((issue) => issue.message)).toEqual([
      "local-demo.notifications.telegram.botTokenEnv is required when Telegram notifications are enabled",
      "local-demo.notifications.telegram.chatIdEnv is required when Telegram notifications are enabled",
    ]);

    const doctorResult = runDoctor(configPath);
    expect(doctorResult.ok).toBe(false);
    if (!doctorResult.ok) {
      expect(doctorResult.issues).toContain(
        "local-demo.notifications.telegram.botTokenEnv is required when Telegram notifications are enabled"
      );
    }
  });

  it("reports missing Telegram runtime env values when names are configured", () => {
    const result = loadConfigFromFile(
      writeConfig(`
version: 1
targets:
  - id: local-demo
    enabled: true
    dumper:
      type: fake
      bytes: dump
    storage:
      type: local
      rootPath: /tmp/backups
    notifications:
      telegram:
        enabled: true
        botTokenEnv: BACKUP_TELEGRAM_BOT_TOKEN
        chatIdEnv: BACKUP_TELEGRAM_CHAT_ID
`)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = result.config.targets[0];
    expect(target).toBeDefined();
    if (target === undefined) return;

    const envResult = resolveTargetEnvReferences(result.config, target, {});

    expect(envResult.ok).toBe(false);
    expect(envResult.issues.map((issue) => issue.envName)).toEqual([
      "BACKUP_TELEGRAM_BOT_TOKEN",
      "BACKUP_TELEGRAM_CHAT_ID",
    ]);
  });

  it("defaults Telegram failure notification policy on when Telegram is enabled", () => {
    const result = loadConfigFromFile(
      writeConfig(`
version: 1
targets:
  - id: local-demo
    enabled: true
    dumper:
      type: fake
      bytes: dump
    storage:
      type: local
      rootPath: /tmp/backups
    notifications:
      telegram:
        enabled: true
        botTokenEnv: BACKUP_TELEGRAM_BOT_TOKEN
        chatIdEnv: BACKUP_TELEGRAM_CHAT_ID
`)
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.targets[0]?.notifications?.telegram?.onFailure).toBe(
        true
      );
      expect(result.config.targets[0]?.notifications?.telegram?.onSuccess).toBe(
        false
      );
    }
  });

  it("does not require env references for disabled targets", () => {
    const result = runDoctor(
      writeConfig(validConfig.replace("enabled: true", "enabled: false"))
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targets[0]?.status).toBe("disabled");
    }
  });

  it("redacts secret-shaped keys in config previews", () => {
    const preview = redactConfigPreview({
      accessKeyIdEnv: "ACCESS_KEY_ID",
      secretAccessKeyEnv: "SECRET_ACCESS_KEY",
      nested: {
        botTokenEnv: "BOT_TOKEN",
        safe: "visible",
      },
    });

    expect(preview).toEqual({
      accessKeyIdEnv: "[REDACTED]",
      secretAccessKeyEnv: "[REDACTED]",
      nested: {
        botTokenEnv: "[REDACTED]",
        safe: "visible",
      },
    });
  });

  it("passes doctor for the disabled example config without production secrets", () => {
    const result = runDoctor("config/targets.example.yaml");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targets).toEqual([
        {
          id: "maintana",
          enabled: false,
          ok: true,
          status: "disabled",
          issues: [],
        },
      ]);
    }
  });
});
