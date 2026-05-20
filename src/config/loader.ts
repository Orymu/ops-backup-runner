import { existsSync, readFileSync } from "node:fs";

import { parse } from "yaml";
import { ZodError } from "zod";

import { backupRunnerConfigSchema } from "./schema.js";
import type { ConfigLoadResult } from "./types.js";

export const loadConfigFromFile = (configPath: string): ConfigLoadResult => {
  if (!existsSync(configPath)) {
    return {
      ok: false,
      message: `Config file not found: ${configPath}`,
      issues: [`Create the file or pass a valid path with --config.`],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      message: `Config file could not be read: ${configPath}`,
      issues: [error instanceof Error ? error.message : "Unknown read error"],
    };
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    return {
      ok: false,
      message: `Config file is not valid YAML: ${configPath}`,
      issues: [error instanceof Error ? error.message : "Unknown YAML error"],
    };
  }

  try {
    return {
      ok: true,
      config: backupRunnerConfigSchema.parse(parsed),
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        message: `Config file failed validation: ${configPath}`,
        issues: error.issues.map(
          (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`
        ),
      };
    }

    return {
      ok: false,
      message: `Config file failed validation: ${configPath}`,
      issues: [error instanceof Error ? error.message : "Unknown parse error"],
    };
  }
};
