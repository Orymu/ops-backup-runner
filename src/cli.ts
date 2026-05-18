#!/usr/bin/env node

export const cliName = "ops-backup-runner";

export const getStartupMessage = (): string =>
  `${cliName}: project harness initialized. Backup commands are not implemented yet.`;

export const main = (): void => {
  process.stdout.write(`${getStartupMessage()}\n`);
};

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  main();
}
