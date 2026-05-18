# Execution Plans

Execution plans are the system of record for non-trivial implementation work.

Use a plan when work spans multiple steps, touches risky behavior, or may be continued by another agent.

## Lifecycle

1. Copy `docs/exec-plans/_template.md`.
2. Save the plan in `docs/exec-plans/active/`.
3. Update the plan during implementation.
4. Record decisions and verification evidence.
5. Move it to `docs/exec-plans/completed/` when complete.

## File Naming

Use:

```text
YYYY-MM-DD_short-topic.md
```

Examples:

```text
2026-05-18_project-harness.md
2026-05-18_config-foundation.md
2026-05-18_postgres-docker-dumper.md
```

## Required For

Execution plans are required for:

- config foundation;
- backup pipeline;
- dumpers;
- storage adapters;
- encryption;
- retention/delete behavior;
- restore behavior;
- production rollout.

Tiny docs-only changes do not need an execution plan.
