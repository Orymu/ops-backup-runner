#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const ownedDocRoots = ["README.md", "AGENTS.md", "docs"];

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "docs/reusable-backup-runner-proposal.md",
  "docs/implementation-plan.md",
  "docs/harness-engineering-proposal.md",
  "docs/engineering/agent-pr-loop.md",
  "docs/engineering/architecture.md",
  "docs/engineering/guardrails.md",
  "docs/engineering/security.md",
  "docs/engineering/testing.md",
  "docs/exec-plans/README.md",
  "docs/exec-plans/_template.md",
];

const requiredReadmeLinks = [
  "docs/reusable-backup-runner-proposal.md",
  "docs/implementation-plan.md",
];

const fail = (messages) => {
  process.stderr.write(`Docs harness failed:\n${messages.join("\n")}\n`);
  process.exit(1);
};

const walkMarkdown = (dir) => {
  if (!existsSync(dir)) return [];

  const out = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      out.push(...walkMarkdown(fullPath));
    } else if (entry.endsWith(".md")) {
      out.push(fullPath);
    }
  }
  return out;
};

const problems = [];

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) {
    problems.push(`- Missing required doc: ${file}`);
  }
}

const readme = readFileSync(path.join(root, "README.md"), "utf8");
for (const link of requiredReadmeLinks) {
  if (!readme.includes(link)) {
    problems.push(`- README.md must link to ${link}`);
  }
}

const localMarkdownLinkPattern = /\[[^\]]+\]\(([^)#][^)]+\.md)(?:#[^)]+)?\)/g;
const markdownFiles = ownedDocRoots.flatMap((entry) => {
  const fullPath = path.join(root, entry);
  if (!existsSync(fullPath)) return [];
  if (statSync(fullPath).isDirectory()) return walkMarkdown(fullPath);
  return entry.endsWith(".md") ? [fullPath] : [];
});

for (const file of markdownFiles) {
  const relativeFile = path.relative(root, file);
  const content = readFileSync(file, "utf8");

  for (const match of content.matchAll(localMarkdownLinkPattern)) {
    const link = match[1];
    if (/^[a-z]+:\/\//i.test(link)) continue;

    const target = path.resolve(path.dirname(file), link);
    if (!existsSync(target)) {
      problems.push(`- Broken local doc link in ${relativeFile}: ${link}`);
    }
  }
}

if (problems.length > 0) {
  fail(problems);
}

process.stdout.write("Docs harness passed.\n");
