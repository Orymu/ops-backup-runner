import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TempWorkspace {
  path: string;
  cleanup(): void;
}

export const createTempWorkspace = (): TempWorkspace => {
  const workspacePath = mkdtempSync(path.join(tmpdir(), "ops-backup-runner-"));

  return {
    path: workspacePath,
    cleanup(): void {
      rmSync(workspacePath, { recursive: true, force: true });
    },
  };
};
