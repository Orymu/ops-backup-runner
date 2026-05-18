# Testing

This repository should use fast tests by default and opt-in runtime tests for real infrastructure.

## Default Test Layer

Default command:

```bash
pnpm test
```

Default tests should cover pure logic and mocked adapters:

- config schema;
- env reference resolution;
- manifest generation;
- artifact naming;
- retention planning;
- command result formatting;
- adapter error normalization.

Default tests must not require:

- Docker;
- R2/S3 credentials;
- Telegram credentials;
- age private identity;
- production servers.

## Integration Tests

Integration tests are opt-in.

Future commands:

```bash
pnpm test:integration
pnpm test:runtime
```

Expected integration coverage:

- PostgreSQL Docker dumper against disposable Postgres;
- S3/R2 adapter against real test bucket;
- age encrypt/decrypt using test keys;
- Telegram notification against test bot/chat.

## Runtime Evidence

Static tests are not enough for backup infrastructure.

Runtime evidence is required for:

- dump behavior;
- restore behavior;
- external storage upload/download;
- encryption/decryption;
- retention deletion;
- production install;
- failure notifications.

Examples:

```bash
pg_restore --list /tmp/maintana.dump
backup-runner prune maintana --dry-run
backup-runner restore maintana --latest --output /tmp/maintana.dump
```

## Test Naming

Use:

```text
test/<area>/<subject>.test.ts
```

Examples:

```text
test/config/schema.test.ts
test/core/manifest.test.ts
test/core/retention.test.ts
test/storage/s3.test.ts
```

## Quality Bar

When adding behavior:

- test happy path;
- test expected failure path;
- test secret redaction if errors include config/context;
- test destructive planning as dry-run before execution behavior.
