# Ops Backup Runner Agent Guide

This repository contains a reusable backup runner for production systems. Treat it as infrastructure, not application feature code.

## Read First

- Engineering proposal: `docs/reusable-backup-runner-proposal.md`
- Implementation plan: `docs/implementation-plan.md`
- Harness proposal: `docs/harness-engineering-proposal.md`
- Guardrails: `docs/engineering/guardrails.md`
- Architecture: `docs/engineering/architecture.md`
- Security: `docs/engineering/security.md`
- Testing: `docs/engineering/testing.md`
- Agent workflow: `docs/engineering/agent-pr-loop.md`
- Execution plans: `docs/exec-plans/README.md`

## Source Map

- `src/cli.ts`: CLI entrypoint only.
- `src/commands`: command orchestration.
- `src/config`: config loading, schema parsing, and env resolution.
- `src/core`: pipeline contracts, manifests, retention, logging, and shared pure logic.
- `src/dumpers`: backup data producers such as PostgreSQL Docker dumpers.
- `src/storage`: storage adapters such as local and S3/R2.
- `src/encryption`: encryption adapters such as `age`.
- `src/notifications`: notification adapters such as Telegram.
- `test`: unit and integration-style tests.
- `tool`: repository harness scripts.
- `docs`: source-of-truth engineering docs and plans.

## Non-Negotiables

- Do not commit secrets, private keys, backup artifacts, `.env`, or service-account files.
- Production backup artifacts must be encrypted before external upload.
- Restore/list/verify behavior is first-class, not optional polish.
- Config must be parsed from `unknown` into typed values before use.
- Do not read `process.env` outside the config/env loading boundary.
- Do not let retention/delete behavior operate on unknown objects without a manifest.
- Do not add backup behavior without tests and verification evidence.
- Do not commit unless the user explicitly asks.

## Architecture Boundaries

- `commands` orchestrate.
- `core` owns shared contracts and pure logic.
- `dumpers` produce backup streams and must not know about storage.
- `storage` persists artifacts and must not know how dumps are produced.
- `encryption` transforms streams/artifacts and must not know project policy.
- `notifications` report outcomes and must not decide backup behavior.
- `config` validates and resolves runtime settings.

## Required Verification

Before claiming completion for code changes, run:

```bash
pnpm verify
```

For docs-only changes, run the relevant docs harness once it exists. Until then, run:

```bash
pnpm format:check
```

Never claim a command passed unless it was actually run.

## Risk Rules

Treat these as high risk:

- dump generation;
- restore;
- retention or deletion;
- encryption;
- external storage;
- credentials/env parsing;
- production install scripts;
- notifications for backup failure.

High-risk changes require an execution plan and runtime evidence.

## Execution Plans

Use `docs/exec-plans/active/` for non-trivial work. Update the plan as implementation progresses, including decisions and verification evidence.

Tiny docs edits do not need an execution plan.
