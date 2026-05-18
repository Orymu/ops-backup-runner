#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirs = new Set([".git", "node_modules", "dist", "coverage"]);
const allowedProcessEnvFiles = new Set([]);

const fail = (messages) => {
  process.stderr.write(
    `Source hygiene harness failed:\n${messages.join("\n")}\n`
  );
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
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      out.push(fullPath);
    }
  }
  return out;
};

const problems = [];
const pendingWorkMarker = "TO" + "DO";

for (const file of walk(root)) {
  const relativeFile = path.relative(root, file).split(path.sep).join("/");
  const content = readFileSync(file, "utf8");

  if (content.includes(pendingWorkMarker)) {
    problems.push(
      `- ${relativeFile} contains ${pendingWorkMarker}. Use an issue/exec-plan note instead.`
    );
  }

  if (/console\.(log|debug|info|warn|error)\s*\(/.test(content)) {
    problems.push(
      `- ${relativeFile} uses console.*. Prefer explicit CLI/logging helpers.`
    );
  }

  if (
    content.includes("process.env") &&
    !allowedProcessEnvFiles.has(relativeFile) &&
    !relativeFile.startsWith("tool/")
  ) {
    problems.push(
      `- ${relativeFile} reads process.env outside the config boundary. Add config loader first.`
    );
  }
}

if (problems.length > 0) {
  fail(problems);
}

process.stdout.write("Source hygiene harness passed.\n");
