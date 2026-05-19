import { spawnSync } from "node:child_process";

export interface ProcessRunResult {
  status: number | null;
  stdout: Buffer;
  stderr: string;
  error?: Error;
}

export interface ProcessRunOptions {
  input?: Buffer;
  env?: Record<string, string | undefined>;
}

export type ProcessRunner = (
  command: string,
  args: string[],
  options?: ProcessRunOptions
) => ProcessRunResult;

export const defaultProcessRunner: ProcessRunner = (command, args, options) => {
  const result = spawnSync(command, args, {
    input: options?.input,
    env: options?.env,
    encoding: "buffer",
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr.toString("utf8"),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
};
