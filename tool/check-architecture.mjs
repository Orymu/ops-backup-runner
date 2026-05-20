#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rulesPath = path.join(root, "tool/lints/architecture-rules.json");

const fail = (messages) => {
  process.stderr.write(
    `Architecture harness failed:\n${messages.join("\n")}\n`
  );
  process.exit(1);
};

const toPosix = (value) => value.split(path.sep).join("/");

const walk = (dir) => {
  if (!existsSync(dir)) return [];

  const out = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      out.push(...walk(fullPath));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry)) {
      out.push(fullPath);
    }
  }

  return out;
};

const globToRegExp = (glob) => {
  const escaped = glob
    .replaceAll(".", "\\.")
    .replaceAll("/", "\\/")
    .replaceAll("**", "__DOUBLE_STAR__")
    .replaceAll("*", "[^/]*")
    .replaceAll("__DOUBLE_STAR__", ".*");
  return new RegExp(`^${escaped}$`);
};

const matchesGlob = (filePath, glob) => globToRegExp(glob).test(filePath);

const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

const resolveImport = (fromFile, specifier) => {
  if (!specifier.startsWith(".")) return null;

  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  return resolved ? toPosix(path.relative(root, resolved)) : null;
};

if (!existsSync(rulesPath)) {
  fail([
    `Missing architecture rules file: ${toPosix(path.relative(root, rulesPath))}`,
  ]);
}

const config = JSON.parse(readFileSync(rulesPath, "utf8"));
const rules = Array.isArray(config.rules) ? config.rules : [];
const violations = [];

for (const file of walk(path.join(root, "src"))) {
  const relativeFile = toPosix(path.relative(root, file));
  const source = readFileSync(file, "utf8");
  const imports = [...source.matchAll(importPattern)].map((match) => match[1]);

  for (const specifier of imports) {
    const resolved = resolveImport(file, specifier);
    if (!resolved) continue;

    for (const rule of rules) {
      if (!matchesGlob(relativeFile, rule.from)) continue;

      for (const disallowed of rule.disallow) {
        if (matchesGlob(resolved, disallowed)) {
          violations.push(
            `- ${rule.name}: ${relativeFile} imports ${resolved} via ${specifier}`
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  fail(violations);
}

process.stdout.write("Architecture harness passed.\n");
