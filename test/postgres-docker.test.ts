import { describe, expect, it } from "vitest";

import type { BackupTarget } from "../src/config/types.js";
import {
  buildPostgresDockerDumpArgs,
  buildPostgresDockerInspectArgs,
  buildPostgresDockerPgDumpCheckArgs,
  checkPostgresDockerTarget,
  createPostgresDockerDumper,
  type ProcessRunner,
} from "../src/dumpers/postgres-docker.js";

const postgresTarget: BackupTarget = {
  id: "maintana",
  enabled: true,
  dumper: {
    type: "postgresDocker",
    container: "maintana-postgres",
    database: "maintana",
    username: "maintana",
    format: "custom",
  },
  storage: {
    type: "local",
    rootPath: "/tmp/backups",
  },
  encryption: {
    type: "none",
  },
};

const okRunner: ProcessRunner = () => ({
  status: 0,
  stdout: Buffer.from("ok"),
  stderr: "",
});

describe("postgres docker dumper", () => {
  it("builds safe docker exec pg_dump args", () => {
    expect(buildPostgresDockerDumpArgs(postgresTarget)).toEqual([
      "exec",
      "maintana-postgres",
      "pg_dump",
      "-U",
      "maintana",
      "-d",
      "maintana",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
    ]);
  });

  it("builds docker doctor check args", () => {
    expect(buildPostgresDockerInspectArgs(postgresTarget)).toEqual([
      "inspect",
      "--type",
      "container",
      "maintana-postgres",
    ]);
    expect(buildPostgresDockerPgDumpCheckArgs(postgresTarget)).toEqual([
      "exec",
      "maintana-postgres",
      "pg_dump",
      "--version",
    ]);
  });

  it("runs pg_dump and verifies the custom dump with pg_restore list", () => {
    const calls: {
      command: string;
      args: string[];
      input: Buffer | undefined;
    }[] = [];
    const runner: ProcessRunner = (command, args, options) => {
      calls.push({ command, args, input: options?.input });
      return {
        status: 0,
        stdout: Buffer.from("custom dump bytes"),
        stderr: "",
      };
    };

    const artifact = createPostgresDockerDumper(runner).dump(postgresTarget);

    expect(artifact.bytes.toString("utf8")).toBe("custom dump bytes");
    expect(artifact.extension).toBe("dump");
    expect(calls).toEqual([
      {
        command: "docker",
        args: buildPostgresDockerDumpArgs(postgresTarget),
        input: undefined,
      },
      {
        command: "pg_restore",
        args: ["--list"],
        input: Buffer.from("custom dump bytes"),
      },
    ]);
  });

  it("returns clear dump failure errors", () => {
    const runner: ProcessRunner = () => ({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: "database does not exist",
    });

    expect(() =>
      createPostgresDockerDumper(runner).dump(postgresTarget)
    ).toThrow(
      "PostgreSQL Docker dump failed for target maintana: database does not exist"
    );
  });

  it("returns clear pg_restore validation errors", () => {
    let callCount = 0;
    const runner: ProcessRunner = () => {
      callCount += 1;
      return callCount === 1
        ? {
            status: 0,
            stdout: Buffer.from("not a custom dump"),
            stderr: "",
          }
        : {
            status: 1,
            stdout: Buffer.alloc(0),
            stderr: "input file does not appear to be a valid archive",
          };
    };

    expect(() =>
      createPostgresDockerDumper(runner).dump(postgresTarget)
    ).toThrow(
      "PostgreSQL dump verification failed for target maintana: input file does not appear to be a valid archive"
    );
  });

  it("reports docker doctor failures", () => {
    const runner: ProcessRunner = (command, args) => {
      if (args.includes("inspect")) {
        return {
          status: 1,
          stdout: Buffer.alloc(0),
          stderr: "No such container",
        };
      }
      return okRunner(command, args);
    };

    expect(checkPostgresDockerTarget(postgresTarget, runner)).toEqual({
      ok: false,
      issues: ["maintana docker container check failed: No such container"],
    });
  });
});
