# Guardrails

This document defines the mechanical guardrails for `ops-backup-runner`.

## Principles

Guardrails should make unsafe backup behavior hard to introduce.

Prefer checks that are:

- deterministic;
- cheap to run locally;
- clear when they fail;
- aligned with CI;
- stronger than repeated review comments.

## Canonical Command

The default local quality gate is:

```bash
pnpm verify
```

It currently covers:

- formatting;
- linting;
- TypeScript type-checking;
- tests;
- production build.

As the harness matures, `pnpm verify` should also include:

- architecture boundary checks;
- source hygiene checks;
- docs checks;
- env example checks;
- project map drift checks;
- security checks.

## Expected Checks

### TypeScript

Use strict TypeScript. Runtime input starts as `unknown` and becomes trusted only after validation.

### Linting

ESLint enforces TypeScript safety and style rules. Do not bypass lint failures by weakening types.

### Tests

Use Vitest for fast unit tests. Real Docker/R2/Telegram checks should be opt-in integration tests, not required by default local verify.

### Build

The CLI must compile to `dist/`.

## When To Add A Guardrail

Add or strengthen a guardrail when:

- the same bug or review comment appears more than once;
- a safety rule can be checked mechanically;
- an agent could reasonably miss the rule from docs alone.

Prefer this order:

1. TypeScript type design.
2. ESLint or config rule.
3. Harness script.
4. Scaffolder/template.
5. Engineering doc.

## Backup-Specific Guardrails

The repo should eventually enforce:

- no `.env` or secret files committed;
- no backup artifact files committed;
- no direct `process.env` outside config loading;
- no unencrypted external backup configuration without explicit unsafe dev override;
- no retention deletion of objects without manifests;
- no source module cycles;
- no boundary violations between dumpers/storage/encryption/notifications.

## Suppressions

Suppressions should be rare and local.

If a suppression is needed, explain why in code or in the active execution plan. If suppressions become common, fix the rule or architecture.
