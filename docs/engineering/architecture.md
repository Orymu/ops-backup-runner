# Architecture

`ops-backup-runner` is a CLI-oriented infrastructure tool. The architecture should keep data production, encryption, storage, retention, and notification responsibilities separate.

## Source Layout

```text
src/
  cli.ts
  commands/
  config/
  core/
  dumpers/
  encryption/
  notifications/
  storage/
```

## Dependency Direction

```text
cli -> commands -> core
commands -> config
commands -> dumpers/storage/encryption/notifications
dumpers -> core/config types
storage -> core/config types
encryption -> core/config types
notifications -> core/config types
```

## Boundary Rules

### Commands

Commands orchestrate user intent. They may call config loaders, core pipeline services, and concrete adapters.

Commands should not contain low-level backup logic.

### Config

Config owns:

- YAML loading;
- schema validation;
- env reference resolution;
- redacted config preview.

No other module should read `process.env` directly.

### Core

Core owns pure contracts and pipeline logic:

- backup job orchestration;
- artifact metadata;
- manifests;
- retention planning;
- error normalization;
- logging contracts.

Core must not import concrete adapters.

### Dumpers

Dumpers produce backup streams.

Dumpers must not know:

- where artifacts are stored;
- how notifications are sent;
- retention policy.

### Storage

Storage adapters persist, list, head, download, and delete artifacts.

Storage must not know:

- how database dumps are produced;
- how encryption works internally;
- how users are notified.

### Encryption

Encryption transforms data.

Encryption must not decide whether a target should be backed up or deleted.

### Notifications

Notifications report job outcomes.

Notifications must not change backup state or hide original backup failures.

## Error Handling

Use typed result objects or domain-specific errors where useful. Do not throw raw third-party errors across module boundaries without normalization.

## Runtime Input

Runtime input includes:

- YAML config;
- environment variables;
- CLI args;
- external command output;
- S3/R2 responses;
- Telegram responses.

Treat runtime input as untrusted until parsed and narrowed.
