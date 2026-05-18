#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const messageFlagIndex = args.indexOf("--message");
const message =
  messageFlagIndex >= 0
    ? args[messageFlagIndex + 1]
    : execFileSync("git", ["log", "-1", "--pretty=%B"], {
        encoding: "utf8",
      });

const firstLine = message?.trim().split("\n")[0] ?? "";
const allowedTypes = [
  "feat",
  "fix",
  "docs",
  "test",
  "refactor",
  "chore",
  "ci",
  "build",
  "perf",
  "revert",
];

const typeGroup = allowedTypes.join("|");
const conventionalCommitPattern = new RegExp(
  `^(${typeGroup})\\([a-z0-9-]+\\): .{1,100}$`
);

if (!conventionalCommitPattern.test(firstLine)) {
  process.stderr.write(
    [
      "Commit message harness failed:",
      `- Received: ${firstLine || "<empty>"}`,
      "- Expected: type(scope): message",
      `- Allowed types: ${allowedTypes.join(", ")}`,
      "- Example: chore(harness): add strict verification gate",
    ].join("\n") + "\n"
  );
  process.exit(1);
}

process.stdout.write("Commit message harness passed.\n");
