# ops-backup-runner

Reusable multi-project backup runner for database dumps, encrypted external storage, retention, verification, and restore workflows.

## Status

Draft planning stage.

## Quickstart

Install dependencies and run the quality gate:

```bash
pnpm install
pnpm verify
```

The CLI currently exposes a minimal baseline command while the product implementation is still behind the harness:

```bash
pnpm build
node dist/cli.js --version
```

## Commit Format

Use scoped Conventional Commits:

```text
type(scope): message
```

Example:

```text
chore(harness): add strict verification gate
```

Validate the latest commit locally:

```bash
pnpm harness:commit
```

## Docs

Start with the engineering proposal and implementation plan:

- [Reusable Multi-Project Backup Runner Proposal](docs/reusable-backup-runner-proposal.md)
- [Implementation Plan](docs/implementation-plan.md)
- [Harness Engineering Proposal](docs/harness-engineering-proposal.md)
- [Systemd Install Guide](docs/deployment/systemd-install.md)
