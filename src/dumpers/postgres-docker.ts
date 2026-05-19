import { getRuntimeEnv } from "../config/env.js";
import type { BackupTarget } from "../config/types.js";
import type { DumpArtifact, Dumper } from "../core/ports.js";
import {
  defaultProcessRunner,
  type ProcessRunner,
  type ProcessRunResult,
} from "../core/process-runner.js";

export { defaultProcessRunner, type ProcessRunner, type ProcessRunResult };

const getPostgresDockerConfig = (target: BackupTarget) => {
  if (target.dumper.type !== "postgresDocker") {
    throw new Error(`Unsupported dumper: ${target.dumper.type}`);
  }

  return target.dumper;
};

export const buildPostgresDockerDumpArgs = (target: BackupTarget): string[] => {
  const dumper = getPostgresDockerConfig(target);
  const args = ["exec"];

  if (dumper.passwordEnv !== undefined) {
    args.push("--env", "PGPASSWORD");
  }

  args.push(
    dumper.container,
    "pg_dump",
    "-U",
    dumper.username,
    "-d",
    dumper.database,
    "--format=custom",
    "--no-owner",
    "--no-privileges"
  );

  return args;
};

export const buildPostgresDockerInspectArgs = (
  target: BackupTarget
): string[] => {
  const dumper = getPostgresDockerConfig(target);
  return ["inspect", "--type", "container", dumper.container];
};

export const buildPostgresDockerPgDumpCheckArgs = (
  target: BackupTarget
): string[] => {
  const dumper = getPostgresDockerConfig(target);
  return ["exec", dumper.container, "pg_dump", "--version"];
};

const mergePasswordEnv = (
  target: BackupTarget
): Record<string, string | undefined> => {
  const dumper = getPostgresDockerConfig(target);
  const runtimeEnv = getRuntimeEnv();
  if (dumper.passwordEnv === undefined) return runtimeEnv;

  return {
    ...runtimeEnv,
    PGPASSWORD: runtimeEnv[dumper.passwordEnv],
  };
};

const assertSuccess = (
  result: ProcessRunResult,
  failureMessage: string
): void => {
  if (result.status === 0) return;

  const detail =
    (result.error?.message ?? result.stderr.trim()) || "unknown error";
  throw new Error(`${failureMessage}: ${detail}`);
};

export const createPostgresDockerDumper = (
  runner: ProcessRunner = defaultProcessRunner
): Dumper<BackupTarget> => ({
  dump(target: BackupTarget): DumpArtifact {
    const dumper = getPostgresDockerConfig(target);
    const dockerBinary = dumper.dockerBinary ?? "docker";
    const dumpResult = runner(
      dockerBinary,
      buildPostgresDockerDumpArgs(target),
      {
        env: mergePasswordEnv(target),
      }
    );

    assertSuccess(
      dumpResult,
      `PostgreSQL Docker dump failed for target ${target.id}`
    );

    const pgRestoreBinary = dumper.pgRestoreBinary ?? "pg_restore";
    const restoreCheck = runner(pgRestoreBinary, ["--list"], {
      input: dumpResult.stdout,
    });

    assertSuccess(
      restoreCheck,
      `PostgreSQL dump verification failed for target ${target.id}`
    );

    return {
      bytes: dumpResult.stdout,
      extension: "dump",
    };
  },
});

export interface PostgresDockerDoctorResult {
  ok: boolean;
  issues: string[];
}

export const checkPostgresDockerTarget = (
  target: BackupTarget,
  runner: ProcessRunner = defaultProcessRunner
): PostgresDockerDoctorResult => {
  if (target.dumper.type !== "postgresDocker") {
    return { ok: true, issues: [] };
  }

  const dockerBinary = target.dumper.dockerBinary ?? "docker";
  const checks = [
    {
      label: "docker binary",
      result: runner(dockerBinary, ["--version"]),
    },
    {
      label: "docker container",
      result: runner(dockerBinary, buildPostgresDockerInspectArgs(target)),
    },
    {
      label: "pg_dump in container",
      result: runner(dockerBinary, buildPostgresDockerPgDumpCheckArgs(target)),
    },
  ];

  const issues = checks
    .filter((check) => check.result.status !== 0)
    .map((check) => {
      const detail =
        (check.result.error?.message ?? check.result.stderr.trim()) ||
        "unknown error";
      return `${target.id} ${check.label} check failed: ${detail}`;
    });

  return {
    ok: issues.length === 0,
    issues,
  };
};
