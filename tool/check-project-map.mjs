#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const agentsPath = path.join(root, "AGENTS.md");

const expectedPaths = [
  "src/cli.ts",
  "src/commands",
  "src/config",
  "src/core",
  "src/dumpers",
  "src/encryption",
  "src/notifications",
  "src/storage",
  "test",
  "tool",
  "docs",
];

const fail = (messages) => {
  process.stderr.write(`Project-map harness failed:\n${messages.join("\n")}\n`);
  process.exit(1);
};

if (!existsSync(agentsPath)) {
  fail(["- Missing AGENTS.md"]);
}

const agents = readFileSync(agentsPath, "utf8");
const problems = [];

for (const expectedPath of expectedPaths) {
  if (!existsSync(path.join(root, expectedPath))) {
    problems.push(`- AGENTS.md references missing path: ${expectedPath}`);
  }

  if (!agents.includes(expectedPath)) {
    problems.push(`- AGENTS.md project map must mention: ${expectedPath}`);
  }
}

if (problems.length > 0) {
  fail(problems);
}

process.stdout.write("Project-map harness passed.\n");
