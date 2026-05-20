import { spawnSync } from "node:child_process";

import { getRuntimeEnv } from "../config/env.js";
import type { BackupRunnerConfig, BackupTarget } from "../config/types.js";
import type { EncryptionAdapter } from "../core/ports.js";
import { getEffectiveEncryptionConfig } from "./policy.js";

export interface AgeProcessRunResult {
  status: number | null;
  stdout: Buffer;
  stderr: string;
  error?: Error;
}

export type AgeProcessRunner = (
  command: string,
  args: string[],
  input: Buffer
) => AgeProcessRunResult;

export const defaultAgeProcessRunner: AgeProcessRunner = (
  command,
  args,
  input
) => {
  const result = spawnSync(command, args, {
    input,
    encoding: "buffer",
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr.toString("utf8"),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
};

const resolveRequiredEnv = (
  name: string | undefined,
  owner: string
): string => {
  if (name === undefined) {
    throw new Error(`Missing env reference for ${owner}`);
  }

  const value = getRuntimeEnv()[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name} for ${owner}`
    );
  }

  return value;
};

const assertSuccess = (
  result: AgeProcessRunResult,
  message: string
): Buffer => {
  if (result.status === 0) return result.stdout;

  const detail =
    (result.error?.message ?? result.stderr.trim()) || "unknown error";
  throw new Error(`${message}: ${detail}`);
};

export const createAgeEncryptionAdapter = (
  config: BackupRunnerConfig,
  target: BackupTarget,
  runner: AgeProcessRunner = defaultAgeProcessRunner
): EncryptionAdapter => {
  const encryption = getEffectiveEncryptionConfig(config, target);
  if (encryption.type !== "age") {
    throw new Error(`Target ${target.id} does not use age encryption`);
  }

  const binary = encryption.binary ?? "age";

  return {
    type: "age",
    encrypt(bytes): Buffer {
      const recipient = resolveRequiredEnv(
        encryption.recipientEnv,
        `${target.id}.encryption.recipientEnv`
      );
      return assertSuccess(
        runner(binary, ["--encrypt", "--recipient", recipient], bytes),
        `Age encryption failed for target ${target.id}`
      );
    },
    decrypt(bytes): Buffer {
      const identityPath = resolveRequiredEnv(
        encryption.identityPathEnv,
        `${target.id}.encryption.identityPathEnv`
      );
      return assertSuccess(
        runner(binary, ["--decrypt", "--identity", identityPath], bytes),
        `Age decryption failed for target ${target.id}`
      );
    },
  };
};
