#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const envExamplePath = path.join(root, ".env.example");

const fail = (messages) => {
  process.stderr.write(`Env harness failed:\n${messages.join("\n")}\n`);
  process.exit(1);
};

if (!existsSync(envExamplePath)) {
  fail(["- Missing .env.example"]);
}

const content = readFileSync(envExamplePath, "utf8");
const problems = [];
const suspiciousValuePattern =
  /^\s*[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|IDENTITY)[A-Z0-9_]*\s*=\s*("?)(?!$|change-me|example|placeholder|<|your-|test-|dummy-).{8,}\2\s*$/;

for (const [index, line] of content.split("\n").entries()) {
  if (!line.trim() || line.trim().startsWith("#")) continue;

  if (!/^[A-Z0-9_]+=/.test(line)) {
    problems.push(`- .env.example line ${index + 1} is not KEY=value format`);
  }

  if (suspiciousValuePattern.test(line)) {
    problems.push(
      `- .env.example line ${index + 1} looks like it may contain a real secret`
    );
  }
}

if (problems.length > 0) {
  fail(problems);
}

process.stdout.write("Env harness passed.\n");
