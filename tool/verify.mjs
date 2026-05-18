#!/usr/bin/env node

import { spawn } from "node:child_process";

const steps = [
  ["Format check", ["pnpm", "format:check"]],
  ["ESLint", ["pnpm", "lint"]],
  ["TypeScript", ["pnpm", "type-check"]],
  ["Tests", ["pnpm", "test"]],
  ["Build", ["pnpm", "build"]],
  ["Architecture harness", ["pnpm", "harness:architecture"]],
  ["Source hygiene harness", ["pnpm", "harness:source"]],
  ["Docs harness", ["pnpm", "harness:docs"]],
  ["Env harness", ["pnpm", "harness:env"]],
  ["Project-map harness", ["pnpm", "harness:project-map"]],
  ["Security harness", ["pnpm", "harness:security"]],
  [
    "Commit message harness",
    [
      "pnpm",
      "harness:commit",
      "--",
      "--message",
      "chore(harness): verify scoped commit message format",
    ],
  ],
];

const run = (command) =>
  new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      shell: false,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });

for (const [title, command] of steps) {
  process.stdout.write(`\n==> ${title}\n`);
  const code = await run(command);

  if (code !== 0) {
    process.exit(code);
  }
}

process.stdout.write("\nVerify passed.\n");
