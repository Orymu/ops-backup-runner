# Ops Backup Runner Harness — Engineering Proposal

Status: Draft for review  
Scope: Repository harness, guardrails, and agent workflow before product implementation  
References:

- `/home/fikrilal/devs/core/backend-core-kit`
- `/home/fikrilal/devs/core/mobile-core-kit`
- `docs/reusable-backup-runner-proposal.md`
- `docs/implementation-plan.md`

## Summary

Before implementing any backup functionality, `ops-backup-runner` needs a mature repository harness.

This project is safety-critical infrastructure. It will handle production database backups, external storage credentials, encryption, retention, restore workflows, and failure notifications across multiple projects. The repo must be strict from day one because most implementation work may be done by agents and reviewed asynchronously.

The first milestone should not be a backup feature. It should be:

```text
strict TypeScript project
  -> canonical verify command
  -> CI
  -> architecture boundaries
  -> docs/exec-plan workflow
  -> security checks
  -> commit/PR rules
  -> agent operating guide
```

## Why Harness First

Backup systems fail dangerously when they are casual:

- a silent config mistake means backups never run;
- leaked secrets expose database backups;
- a retention bug deletes valid backups;
- a restore path missing from the implementation makes backups untrustworthy;
- loosely typed config can point a project at the wrong bucket;
- agent-written code can drift into over-abstracted or unsafe behavior.

The harness should make unsafe changes mechanically difficult.

## Design Goals

### Strict By Default

The codebase should use strict TypeScript and fail early for ambiguous behavior.

Required posture:

- no implicit `any`;
- exact optional types;
- unchecked indexed access handled explicitly;
- explicit return paths;
- no hidden global config reads in domain logic;
- no raw untyped YAML objects after config parsing.

### Agent-Friendly

Agents should be able to discover the repo rules quickly.

Required docs:

- `AGENTS.md` as the compact operating contract;
- `docs/engineering/guardrails.md`;
- `docs/engineering/agent-pr-loop.md`;
- `docs/engineering/architecture.md`;
- `docs/engineering/security.md`;
- `docs/exec-plans/README.md`;
- `docs/exec-plans/_template.md`.

### Config-Driven Rules

Architecture and source rules should be codified in config where practical.

Recommended:

```text
tool/lints/architecture-rules.json
tool/lints/source-rules.json
```

The harness should read the rule files instead of hardcoding every boundary in script code.

### One Canonical Gate

Everyone should know the command:

```bash
pnpm verify
```

CI should run the same command.

## Proposed Repo Foundation

Initial structure:

```text
ops-backup-runner/
  AGENTS.md
  README.md
  package.json
  pnpm-lock.yaml
  tsconfig.json
  tsconfig.build.json
  eslint.config.mjs
  prettier.config.mjs
  vitest.config.ts
  .env.example
  .gitignore

  .github/
    workflows/
      ci.yml
    pull_request_template.md

  docs/
    implementation-plan.md
    reusable-backup-runner-proposal.md
    harness-engineering-proposal.md
    engineering/
      architecture.md
      agent-pr-loop.md
      guardrails.md
      security.md
      testing.md
    exec-plans/
      README.md
      _template.md
      active/
        .gitkeep
      completed/
        .gitkeep

  src/
    cli.ts
    commands/
    config/
    core/
    dumpers/
    encryption/
    notifications/
    storage/

  test/

  tool/
    verify.mjs
    check-architecture.mjs
    check-commit-message.mjs
    check-docs.mjs
    check-env-example.mjs
    check-project-map.mjs
    check-security.mjs
    check-source-hygiene.mjs
    lints/
      architecture-rules.json
      source-rules.json
    agent/
      pr-ready-check.sh
      runtime-evidence-check.sh
```

Do not create empty implementation files such as `service.ts`, `repository.ts`, or adapters before they have behavior. Use `.gitkeep` only where an empty folder is valuable.

## Package Manager

Use `pnpm`.

Reasons:

- fast install;
- lockfile is stable;
- already used in Maintana;
- good fit for TypeScript CLI tooling.

Recommended `package.json` baseline:

```json
{
  "packageManager": "pnpm@10.23.0",
  "engines": {
    "node": "22.x",
    "pnpm": ">=10"
  },
  "type": "module"
}
```

## TypeScript Strictness

Recommended `tsconfig.json` posture:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

Policy:

- Avoid `any`.
- Prefer `unknown` at boundaries, then parse with Zod.
- Prefer discriminated unions for command results, storage results, dumper results, and error types.
- Prefer explicit types at public module boundaries.
- Avoid default exports except where a third-party framework requires them.

## ESLint And Formatting

Use flat ESLint config.

Recommended lint expectations:

- TypeScript recommended type-checked rules.
- No floating promises.
- No unsafe assignment/member access/calls.
- No explicit `any`.
- Prefer nullish coalescing.
- Prefer optional chaining.
- Exhaustive switch checks where practical.
- Import ordering if supported cleanly.

Use Prettier as the formatting authority.

Commands:

```bash
pnpm format
pnpm format:check
pnpm lint
```

## Test Stack

Use Vitest.

Test structure:

```text
test/
  config/
  core/
  dumpers/
  storage/
  encryption/
  notifications/
```

Test categories:

- unit tests for pure logic;
- integration-style tests with fake process/storage where useful;
- no real R2/Telegram/Docker tests in default `pnpm verify`.

Future real integration tests should be opt-in:

```bash
pnpm test:integration
```

## Canonical Verification

`pnpm verify` should call `tool/verify.mjs`.

Recommended verify sequence:

```text
1. format check
2. TypeScript type-check
3. ESLint
4. unit tests
5. build
6. architecture harness
7. source hygiene harness
8. docs harness
9. env example harness
10. project map drift harness
11. security/dependency harness
```

Example scripts:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "test": "vitest run",
    "type-check": "tsc --noEmit",
    "harness:architecture": "node tool/check-architecture.mjs",
    "harness:commit": "node tool/check-commit-message.mjs",
    "harness:docs": "node tool/check-docs.mjs",
    "harness:env": "node tool/check-env-example.mjs",
    "harness:project-map": "node tool/check-project-map.mjs",
    "harness:security": "node tool/check-security.mjs",
    "harness:source": "node tool/check-source-hygiene.mjs",
    "verify": "node tool/verify.mjs"
  }
}
```

## Architecture Boundaries

This repo should keep dependency direction explicit.

Initial source layout:

```text
src/cli.ts
src/commands/
src/config/
src/core/
src/dumpers/
src/storage/
src/encryption/
src/notifications/
```

Recommended dependency rules:

| Area            | Allowed To Depend On       | Must Not Depend On                       |
| --------------- | -------------------------- | ---------------------------------------- |
| `cli.ts`        | `commands`, `config`       | implementation internals where avoidable |
| `commands`      | `config`, `core`, adapters | tests                                    |
| `core`          | shared types/utilities     | `commands`, concrete adapters            |
| `config`        | schema/types/utilities     | `commands`, concrete job execution       |
| `dumpers`       | `core`, `config` types     | `storage`, `notifications`               |
| `storage`       | `core`, `config` types     | `dumpers`, `notifications`               |
| `encryption`    | `core`, `config` types     | `storage`, `dumpers`                     |
| `notifications` | `core`, `config` types     | `dumpers`, `storage`                     |

Important rule:

```text
Dumpers do not know where artifacts are stored.
Storage does not know how artifacts are created.
Encryption does not know project-specific backup policy.
Commands orchestrate; core defines pipeline contracts.
```

The first architecture harness can be import-boundary based. It does not need AST sophistication yet.

Example `tool/lints/architecture-rules.json`:

```json
{
  "rules": [
    {
      "name": "core-must-not-import-commands",
      "from": "src/core/**",
      "disallow": ["src/commands/**"]
    },
    {
      "name": "dumpers-must-not-import-storage",
      "from": "src/dumpers/**",
      "disallow": ["src/storage/**"]
    },
    {
      "name": "storage-must-not-import-dumpers",
      "from": "src/storage/**",
      "disallow": ["src/dumpers/**"]
    },
    {
      "name": "notifications-must-not-import-dumpers-or-storage",
      "from": "src/notifications/**",
      "disallow": ["src/dumpers/**", "src/storage/**"]
    }
  ]
}
```

## Source Hygiene Harness

Add a simple source hygiene script before implementation grows.

Initial checks:

- no `TODO` without issue/reference;
- no `console.log` in source except CLI presentation layer;
- no direct `process.env` access outside config loader;
- no raw secret-like variable names printed in source;
- no committed `.env`;
- no committed private key files;
- no empty behavior files;
- no `any` escape comments unless explicitly allowlisted.

Secret-like patterns:

```text
PRIVATE_KEY
SECRET
TOKEN
PASSWORD
ACCESS_KEY
AGE_IDENTITY
```

The script should check source and docs conservatively and avoid false positives in examples where values are placeholders.

## Env Harness

The `.env.example` must stay synchronized with config docs.

Initial rules:

- every env var used by config examples exists in `.env.example`;
- `.env.example` contains placeholder values only;
- no real token/key-shaped values;
- required production variables are documented.

The env harness can begin as a static string checker and mature later.

## Docs Harness

Docs are part of the product for this repo because restore and operations depend on them.

Initial docs checks:

- `README.md` links to proposal and implementation plan;
- `docs/implementation-plan.md` exists;
- `docs/reusable-backup-runner-proposal.md` exists;
- `docs/engineering/guardrails.md` exists after harness phase;
- `docs/exec-plans/README.md` exists after harness phase;
- no broken local doc links where practical.

## Project Map Drift

`AGENTS.md` should include a compact project map.

The project-map harness should ensure major directories mentioned in `AGENTS.md` exist and that major source directories are documented.

This keeps agents oriented after the repo grows.

## Commit Message Harness

Use scoped Conventional Commits.

Pattern:

```text
type(scope): message
```

Allowed types:

```text
feat
fix
docs
test
refactor
chore
ci
build
perf
revert
```

Examples:

```text
docs(plan): add backup runner implementation plan
chore(harness): add strict typescript project setup
feat(config): load validated target config
test(retention): cover daily prune planner
```

CI should validate the latest commit message on push/PR.

## Security Harness

Initial security check:

```bash
pnpm audit --audit-level=high
```

But dependency audit alone is not enough.

Add repository security checks:

- no `.env` committed;
- no `*.pem`, `*.key`, `age-identity.txt`, service account JSON committed;
- no obvious R2/Telegram secret examples;
- no production backup artifact extensions committed:
  - `.dump`;
  - `.dump.gz`;
  - `.dump.gz.age`;
  - `.sql`;
  - `.sql.gz`;
  - `.backup`.

## CI

Add GitHub Actions:

```text
.github/workflows/ci.yml
```

Required jobs:

- checkout;
- setup pnpm;
- setup Node 22;
- install with frozen lockfile;
- validate commit message;
- run `pnpm verify`.

CI should run on:

- pull request;
- push to `master`.

## PR Template

The PR template should force operators/agents to state:

- what changed;
- risk level;
- verification commands;
- whether runtime evidence is required;
- whether docs changed;
- whether secrets/config/backup behavior changed.

Backup-specific checklist:

- Does this affect backup creation?
- Does this affect restore?
- Does this affect retention/delete behavior?
- Does this affect encryption?
- Does this affect external storage credentials?
- Does this affect notification behavior?

## AGENTS.md

`AGENTS.md` should be short and strict.

It should include:

- repo purpose;
- source map;
- canonical verification command;
- no-commit-without-user-ask rule;
- no secret commits;
- architecture boundaries;
- docs/exec-plan expectations;
- production safety language.

Recommended rule:

```text
For any change touching dump, restore, retention, encryption, storage, or credentials, treat risk as high and require explicit verification evidence.
```

## Execution Plans

Mirror the mobile-core-kit approach.

Add:

```text
docs/exec-plans/
  README.md
  _template.md
  active/
    .gitkeep
  completed/
    .gitkeep
```

Use exec plans for:

- config foundation;
- local pipeline;
- postgres dumper;
- S3/R2 storage;
- age encryption;
- retention;
- production rollout.

Do not require exec plans for tiny docs typos.

## Runtime Evidence

Runtime evidence is required for behavior that static tests cannot prove.

Add:

```text
tool/agent/runtime-evidence-check.sh
docs/engineering/runtime-evidence.md
```

Evidence requirements by area:

| Area               | Evidence                                 |
| ------------------ | ---------------------------------------- |
| local pipeline     | backup/list/restore command output       |
| postgres dumper    | `pg_restore --list` output               |
| R2 storage         | uploaded object key + head/list result   |
| age encryption     | encrypted artifact restore/decrypt smoke |
| retention          | prune dry-run output                     |
| notification       | failure alert test output                |
| systemd            | `systemctl status` and timer list        |
| production rollout | backup object + restore verification     |

## Scaffolding

Add lightweight scaffolding only after the first source layout is stable.

Potential command:

```bash
pnpm scaffold:adapter -- --type storage --name local
pnpm scaffold:adapter -- --type dumper --name postgres-docker
```

Do not overbuild scaffolding in Phase 1. For now, a documented source layout and architecture harness are enough.

## What Not To Build In Harness Phase

Do not build:

- real backup command behavior;
- Docker dumper;
- R2 storage;
- age encryption;
- notification sending;
- systemd install scripts.

Harness phase should stop when:

- strict project compiles;
- tests run;
- CI runs;
- architecture/docs/security checks exist;
- repo has agent guidance and exec-plan workflow.

## Implementation Phases For Harness

### Phase H1 — Node/TypeScript Baseline

Tasks:

- create `package.json`;
- create `pnpm-lock.yaml`;
- create strict `tsconfig.json`;
- create `tsconfig.build.json`;
- create minimal `src/cli.ts`;
- add Vitest;
- add ESLint;
- add Prettier;
- add `pnpm verify`.

Acceptance criteria:

- `pnpm verify` passes;
- `pnpm build` outputs CLI JavaScript;
- no backup behavior exists yet.

### Phase H2 — Docs And Agent Operating Contract

Tasks:

- add `AGENTS.md`;
- add `docs/engineering/guardrails.md`;
- add `docs/engineering/agent-pr-loop.md`;
- add `docs/engineering/architecture.md`;
- add `docs/engineering/security.md`;
- add `docs/engineering/testing.md`;
- add exec-plan directory and template.

Acceptance criteria:

- docs explain how agents should work;
- docs explain risk levels and evidence expectations;
- no implementation ambiguity for harness behavior.

### Phase H3 — Harness Scripts

Tasks:

- add `tool/verify.mjs`;
- add architecture harness;
- add docs harness;
- add env harness;
- add source hygiene harness;
- add project-map drift harness;
- add security harness;
- add commit message harness.

Acceptance criteria:

- `pnpm verify` calls all default checks;
- harness failures are clear and actionable;
- no check depends on unavailable production secrets.

### Phase H4 — CI And PR Workflow

Tasks:

- add `.github/workflows/ci.yml`;
- add `.github/pull_request_template.md`;
- ensure CI uses Node 22 and pnpm;
- validate scoped Conventional Commit message;
- run `pnpm verify`.

Acceptance criteria:

- CI passes on a clean checkout;
- PR template captures backup-specific risk;
- latest commit message validation works.

### Phase H5 — Harness Smoke

Tasks:

- run `pnpm verify`;
- intentionally test one or two harness failures locally if practical;
- document verification in implementation plan or exec plan.

Acceptance criteria:

- harness is ready for Phase 2 product implementation;
- project has a stable quality gate for agents.

## Recommendation

Implement harness before any backup behavior.

For this project, the right first PR is:

```text
chore(harness): add strict repository foundation
```

It should include TypeScript, linting, tests, CI, docs, architecture rules, security checks, and agent workflow. After that is green, proceed to config foundation.
