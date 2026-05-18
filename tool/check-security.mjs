#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirs = new Set([".git", "node_modules", "dist", "coverage"]);
const forbiddenFilePatterns = [
  /^\.env$/,
  /^\.env\.(?!example$).+/,
  /(^|\/)age-identity\.txt$/,
  /\.(pem|key|p12|pfx)$/,
  /service-account.*\.json$/,
  /\.(dump|dump\.gz|dump\.gz\.age|sql|sql\.gz|backup)$/,
];

const fail = (messages) => {
  process.stderr.write(`Security harness failed:\n${messages.join("\n")}\n`);
  process.exit(1);
};

const walk = (dir) => {
  if (!existsSync(dir)) return [];

  const out = [];
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;

    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      out.push(...walk(fullPath));
    } else {
      out.push(fullPath);
    }
  }
  return out;
};

const problems = [];

for (const file of walk(root)) {
  const relativeFile = path.relative(root, file).split(path.sep).join("/");
  if (forbiddenFilePatterns.some((pattern) => pattern.test(relativeFile))) {
    problems.push(
      `- Forbidden secret/backup artifact file present: ${relativeFile}`
    );
  }
}

try {
  execFileSync("pnpm", ["audit", "--audit-level=high"], {
    cwd: root,
    stdio: "pipe",
  });
} catch (error) {
  const output = `${error.stdout?.toString() ?? ""}${error.stderr?.toString() ?? ""}`;
  problems.push(
    "- pnpm audit found high severity dependency issues or failed to run",
    output.trim() ? output.trim() : "  No audit output was provided."
  );
}

if (problems.length > 0) {
  fail(problems);
}

process.stdout.write("Security harness passed.\n");
