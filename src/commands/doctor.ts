import { loadConfigFromFile } from "../config/loader.js";
import { redactConfigPreview } from "../config/redact.js";
import { resolveTargetEnvReferences } from "../config/env.js";
import type { BackupRunnerConfig, BackupTarget } from "../config/types.js";

export interface DoctorTargetResult {
  id: string;
  enabled: boolean;
  ok: boolean;
  status: "ready" | "disabled" | "missing-env";
  issues: string[];
}

export type DoctorResult =
  | {
      ok: true;
      config: BackupRunnerConfig;
      redactedConfig: BackupRunnerConfig;
      targets: DoctorTargetResult[];
    }
  | {
      ok: false;
      message: string;
      issues: string[];
    };

const inspectTarget = (
  config: BackupRunnerConfig,
  target: BackupTarget
): DoctorTargetResult => {
  if (!target.enabled) {
    return {
      id: target.id,
      enabled: false,
      ok: true,
      status: "disabled",
      issues: [],
    };
  }

  const envResult = resolveTargetEnvReferences(config, target);

  return {
    id: target.id,
    enabled: true,
    ok: envResult.ok,
    status: envResult.ok ? "ready" : "missing-env",
    issues: envResult.issues.map((issue) => issue.message),
  };
};

export const runDoctor = (configPath: string): DoctorResult => {
  const loadResult = loadConfigFromFile(configPath);
  if (!loadResult.ok) {
    return loadResult;
  }

  const targets = loadResult.config.targets.map((target) =>
    inspectTarget(loadResult.config, target)
  );
  const failedTargets = targets.filter((target) => !target.ok);

  if (failedTargets.length > 0) {
    return {
      ok: false,
      message: "Config is valid, but required runtime environment is missing.",
      issues: failedTargets.flatMap((target) => target.issues),
    };
  }

  return {
    ok: true,
    config: loadResult.config,
    redactedConfig: redactConfigPreview(
      loadResult.config
    ) as BackupRunnerConfig,
    targets,
  };
};

export const formatDoctorResult = (result: DoctorResult): string => {
  if (!result.ok) {
    return [
      `Doctor failed: ${result.message}`,
      ...result.issues.map((issue) => `- ${issue}`),
    ].join("\n");
  }

  return [
    "Doctor passed.",
    ...result.targets.map((target) => `- ${target.id}: ${target.status}`),
  ].join("\n");
};
