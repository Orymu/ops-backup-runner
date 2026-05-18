import type { BackupRunnerConfig, BackupTarget } from "./types.js";

export type TargetSelectionResult =
  | {
      ok: true;
      targets: BackupTarget[];
    }
  | {
      ok: false;
      message: string;
    };

export const selectTargets = (
  config: BackupRunnerConfig,
  targetId: string
): TargetSelectionResult => {
  if (targetId === "all") {
    return {
      ok: true,
      targets: config.targets.filter((target) => target.enabled),
    };
  }

  const target = config.targets.find((item) => item.id === targetId);
  if (target === undefined) {
    return {
      ok: false,
      message: `Unknown target: ${targetId}`,
    };
  }

  return {
    ok: true,
    targets: [target],
  };
};
