# Agent PR Loop

This document defines the default delivery loop for agent-authored work.

## 1. Intake

Before implementation:

- identify the target phase from `docs/implementation-plan.md`;
- define acceptance criteria;
- classify risk;
- create an execution plan for non-trivial or medium/high-risk work.

Risk classes:

- `low`: docs, tests, local pure refactors, harness-only edits without runtime behavior.
- `medium`: config parsing, CLI UX, local pipeline behavior, adapter interfaces.
- `high`: dump, restore, encryption, external storage, retention/delete, production install, credentials, notifications.

## 2. Plan

Use:

```text
docs/exec-plans/active/
```

Plans must include:

- objective;
- constraints;
- acceptance criteria;
- implementation checklist;
- decision log;
- verification evidence;
- runtime evidence when required.

## 3. Implement

Rules:

- keep changes small and reversible;
- follow architecture boundaries;
- do not add speculative adapters or features;
- parse untrusted input at boundaries;
- keep secrets and raw env access out of business logic;
- update docs when behavior or workflow changes.

## 4. Verify

Run:

```bash
pnpm verify
```

Run targeted runtime evidence when static checks are insufficient.

Examples:

- `pg_restore --list` for PostgreSQL dump behavior;
- R2 object `head`/`list` evidence for storage behavior;
- `age` decrypt smoke for encryption behavior;
- retention dry-run output for prune behavior;
- Telegram failure alert output for notification behavior.

## 5. Self-Review

Before handoff:

- acceptance criteria are met;
- tests cover changed behavior;
- failure paths are explicit;
- no secrets or backup artifacts are staged;
- docs are updated;
- runtime evidence exists when required;
- the active execution plan is updated.

## 6. Commit And Push

Do not commit or push unless explicitly asked.

When committing, use scoped Conventional Commits:

```text
type(scope): message
```

Examples:

```text
chore(harness): add strict typescript baseline
feat(config): load target config
test(retention): cover prune planner
```

## 7. Done

Work is done only when:

1. acceptance criteria are satisfied;
2. verification commands pass;
3. required runtime evidence is collected;
4. docs and execution plans are current;
5. residual risk is called out.
