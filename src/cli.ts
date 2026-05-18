#!/usr/bin/env node

import { formatDoctorResult, runDoctor } from "./commands/doctor.js";

export const cliName = "ops-backup-runner";

export const getStartupMessage = (): string =>
  `${cliName}: project harness initialized. Backup commands are not implemented yet.`;

const getFlagValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
};

export const main = (): void => {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "doctor") {
    const configPath = getFlagValue(args, "--config");
    if (configPath === undefined) {
      process.stderr.write("Doctor failed: missing --config <path>\n");
      process.exitCode = 2;
      return;
    }

    const result = runDoctor(configPath);
    const formatted = formatDoctorResult(result);
    const output = result.ok ? process.stdout : process.stderr;
    output.write(`${formatted}\n`);
    process.exitCode = result.ok ? 0 : 2;
    return;
  }

  process.stdout.write(`${getStartupMessage()}\n`);
};

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  main();
}
