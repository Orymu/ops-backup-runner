# Reusable Multi-Project Backup Runner — Engineering Proposal

Status: Draft for review  
Scope: Shared backup system for Orymu backend, Kevly, Maintana, and future projects  
Primary goal: Build one mature backup platform that can be reused across projects instead of implementing app-specific backup scripts.

## Summary

We should build a standalone backup runner that can back up multiple systems from declarative configuration.

The runner should support:

- multiple projects;
- multiple database/container targets;
- per-project R2/S3 storage destinations;
- compression;
- encryption before upload;
- retention cleanup;
- backup verification;
- restore/download commands;
- structured logs;
- failure notifications;
- systemd-based scheduling on production servers.

This should not live inside Maintana. It should be a reusable operations tool installed on the server and used by multiple apps.

Recommended repo/location:

```text
/home/fikrilal/devs/core/ops-backup-runner
```

Recommended production install path:

```text
/opt/orymu/ops-backup-runner
```

## Why A Shared Backup Runner

Current and future systems will share the same operational need:

```text
database -> dump -> compress -> encrypt -> upload externally -> verify -> prune -> alert
```

If every project implements this separately, we will create duplicated scripts, inconsistent retention, missing restore docs, and uneven reliability.

A shared runner gives us:

- one hardened implementation;
- one configuration pattern;
- one retention engine;
- one restore workflow;
- one notification channel;
- one place to improve reliability for every project.

## Design Principles

### Backups Are Production Infrastructure

This is not a helper script. Treat it like production infrastructure.

Required behavior:

- fail loudly when backup fails;
- never silently skip configured targets;
- never print secrets;
- never store unencrypted database backups in external object storage;
- always keep restore as a first-class workflow.

### Each Project Owns Its Storage Destination

The runner must support both models:

```text
One Cloudflare account + multiple buckets
Different Cloudflare accounts per project
```

Storage config must be per target, not global.

This allows:

- Maintana backups to use Maintana-specific R2 credentials;
- Kevly backups to use Kevly-specific R2 credentials;
- Orymu backend backups to use Orymu-owned storage;
- future client projects to use client-owned Cloudflare accounts.

### Configuration References Secrets By Env Name

Do not put raw secrets in config files.

Config should reference environment variable names:

```yaml
storage:
  accessKeyIdEnv: MAINTANA_BACKUP_R2_ACCESS_KEY_ID
  secretAccessKeyEnv: MAINTANA_BACKUP_R2_SECRET_ACCESS_KEY
```

The runner loads values at runtime.

### Backup Without Restore Is Incomplete

The system must include restore/list/verify commands from day one.

Minimum CLI:

```bash
backup-runner backup maintana
backup-runner backup all
backup-runner list maintana
backup-runner verify maintana --latest
backup-runner prune maintana
backup-runner restore maintana --backup <backup-id> --output /tmp/maintana.dump
backup-runner doctor
```

## System Architecture

Core pipeline:

```text
Backup Target
  -> Dump Strategy
  -> Artifact Pipeline
  -> Encryption
  -> Storage Destination
  -> Upload Verification
  -> Retention Policy
  -> Logs
  -> Notifications
```

Concrete flow:

```text
1. Load and validate config
2. Resolve target
3. Create temp workspace
4. Run dumper
5. Compress artifact
6. Encrypt artifact
7. Upload artifact to configured storage
8. Verify uploaded object exists and metadata matches
9. Write manifest
10. Apply retention policy
11. Delete local temp files
12. Emit structured result
13. Send failure/success notification according to policy
```

## Proposed Repo Structure

```text
ops-backup-runner/
  README.md
  package.json
  tsconfig.json
  .env.example

  src/
    cli.ts

    config/
      loader.ts
      schema.ts
      types.ts

    core/
      backup-job.ts
      artifact.ts
      errors.ts
      logging.ts
      manifest.ts
      retention.ts
      temp-workspace.ts

    dumpers/
      postgres-docker.ts
      postgres-url.ts
      mysql-docker.ts
      types.ts

    storage/
      s3.ts
      local.ts
      types.ts

    encryption/
      age.ts
      none.ts
      types.ts

    notifications/
      telegram.ts
      webhook.ts
      types.ts

    commands/
      backup.ts
      doctor.ts
      list.ts
      prune.ts
      restore.ts
      verify.ts

  config/
    targets.example.yaml

  systemd/
    backup-runner.service
    backup-runner.timer

  docs/
    restore.md
    deployment.md
    operations.md
```

## Technology Choice

Recommended implementation: TypeScript Node CLI.

Why:

- fits the current stack;
- easy to write typed config validation with Zod;
- easy S3/R2 integration using AWS SDK v3;
- easy Telegram/webhook notifications;
- better testability than shell-only scripts;
- still easy to run through systemd.

Key dependencies:

```text
zod
yaml
commander
@aws-sdk/client-s3
@aws-sdk/lib-storage
```

Encryption can call the `age` binary initially. Later we can use a native library if needed.

## Configuration Model

Example `targets.yaml`:

```yaml
version: 1

defaults:
  timezone: Asia/Jakarta
  compression: gzip
  encryption:
    type: age
    recipientEnv: BACKUP_AGE_RECIPIENT
  retention:
    daily: 14
    weekly: 8
    monthly: 6
  notifications:
    onSuccess: false
    onFailure: true

targets:
  - id: maintana
    label: Maintana Production
    enabled: true
    tags: [prod, postgres, client]

    dumper:
      type: postgresDocker
      container: maintana-postgres
      database: maintana
      username: maintana
      format: custom

    storage:
      type: s3
      endpointEnv: MAINTANA_BACKUP_S3_ENDPOINT
      region: auto
      bucket: maintana-db-backups
      prefix: maintana/postgres
      accessKeyIdEnv: MAINTANA_BACKUP_S3_ACCESS_KEY_ID
      secretAccessKeyEnv: MAINTANA_BACKUP_S3_SECRET_ACCESS_KEY
      forcePathStyle: false

  - id: kevly
    label: Kevly Production
    enabled: true
    tags: [prod, postgres]

    dumper:
      type: postgresDocker
      container: kevly-postgres
      database: kevly
      username: kevly
      format: custom

    storage:
      type: s3
      endpointEnv: KEVLY_BACKUP_S3_ENDPOINT
      region: auto
      bucket: kevly-db-backups
      prefix: kevly/postgres
      accessKeyIdEnv: KEVLY_BACKUP_S3_ACCESS_KEY_ID
      secretAccessKeyEnv: KEVLY_BACKUP_S3_SECRET_ACCESS_KEY
      forcePathStyle: false

  - id: orymu-backend
    label: Orymu Backend Production
    enabled: true
    tags: [prod, postgres, internal]

    dumper:
      type: postgresDocker
      container: orymu-postgres
      database: orymu
      username: orymu
      format: custom

    storage:
      type: s3
      endpointEnv: ORYMU_BACKUP_S3_ENDPOINT
      region: auto
      bucket: orymu-system-backups
      prefix: orymu-backend/postgres
      accessKeyIdEnv: ORYMU_BACKUP_S3_ACCESS_KEY_ID
      secretAccessKeyEnv: ORYMU_BACKUP_S3_SECRET_ACCESS_KEY
      forcePathStyle: false
```

This supports:

- same R2 account with different buckets;
- different R2 accounts with different endpoints/credentials;
- shared bucket with different prefixes;
- future S3-compatible providers.

## Environment Model

Example `.env`:

```env
BACKUP_CONFIG_PATH=/opt/orymu/ops-backup-runner/config/targets.yaml
BACKUP_TMP_DIR=/var/tmp/orymu-backups
BACKUP_LOG_DIR=/var/log/orymu-ops-backup-runner

BACKUP_AGE_RECIPIENT=age1...
BACKUP_AGE_IDENTITY_PATH=/opt/orymu/ops-backup-runner/secrets/age-identity.txt

MAINTANA_BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
MAINTANA_BACKUP_S3_ACCESS_KEY_ID=
MAINTANA_BACKUP_S3_SECRET_ACCESS_KEY=

KEVLY_BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
KEVLY_BACKUP_S3_ACCESS_KEY_ID=
KEVLY_BACKUP_S3_SECRET_ACCESS_KEY=

ORYMU_BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
ORYMU_BACKUP_S3_ACCESS_KEY_ID=
ORYMU_BACKUP_S3_SECRET_ACCESS_KEY=

BACKUP_TELEGRAM_BOT_TOKEN=
BACKUP_TELEGRAM_CHAT_ID=
```

Rules:

- `.env` must never be committed.
- config files may be committed only if they contain no raw secrets.
- `doctor` command validates env references exist.

## Backup Artifact Format

Recommended object key:

```text
<prefix>/<cadence>/<yyyy>/<mm>/<target>-<database>-<timestamp>-<short-id>.dump.gz.age
```

Example:

```text
maintana/postgres/daily/2026/05/maintana-maintana-20260518T020000Z-a1b2c3.dump.gz.age
```

Manifest object:

```text
maintana/postgres/daily/2026/05/maintana-maintana-20260518T020000Z-a1b2c3.manifest.json
```

Manifest example:

```json
{
  "version": 1,
  "targetId": "maintana",
  "dumperType": "postgresDocker",
  "database": "maintana",
  "createdAt": "2026-05-18T02:00:00.000Z",
  "artifact": {
    "key": "maintana/postgres/daily/2026/05/maintana-maintana-20260518T020000Z-a1b2c3.dump.gz.age",
    "sizeBytes": 1234567,
    "sha256": "..."
  },
  "compression": "gzip",
  "encryption": "age",
  "storage": {
    "type": "s3",
    "bucket": "maintana-db-backups",
    "prefix": "maintana/postgres"
  }
}
```

## Dumpers

### Phase 1 Dumper: PostgreSQL Docker

Use Docker container access for apps deployed with Docker Compose.

Command shape:

```bash
docker exec <container> pg_dump \
  -U <username> \
  -d <database> \
  --format=custom \
  --no-owner \
  --no-privileges
```

The runner should stream stdout to the artifact pipeline instead of writing huge plain dumps to disk.

### Future Dumper: PostgreSQL URL

For managed Postgres or non-Docker deployments:

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges
```

### Future Dumper: MySQL Docker

For MySQL/MariaDB projects:

```bash
docker exec <container> mysqldump ...
```

Keep the dumper interface generic:

```ts
type Dumper = {
  dump(input: DumpInput): Promise<Readable>;
};
```

## Storage

### S3/R2 Storage

Primary storage adapter should support S3-compatible APIs.

Cloudflare R2 config:

```yaml
storage:
  type: s3
  endpointEnv: MAINTANA_BACKUP_S3_ENDPOINT
  region: auto
  bucket: maintana-db-backups
  prefix: maintana/postgres
  accessKeyIdEnv: MAINTANA_BACKUP_S3_ACCESS_KEY_ID
  secretAccessKeyEnv: MAINTANA_BACKUP_S3_SECRET_ACCESS_KEY
  forcePathStyle: false
```

Adapter responsibilities:

- upload object;
- head object to verify existence, size, and metadata;
- list objects by prefix;
- delete objects during retention pruning;
- download object for restore.

### Local Storage

Local storage should exist for development and restore testing only.

It should not be accepted as the only production storage target unless explicitly configured with a warning.

## Encryption

Use `age` encryption by default.

Why `age`:

- simple CLI;
- less operational complexity than GPG;
- easy public recipient for encryption;
- private identity needed only for restore.

Recommended behavior:

```text
pg_dump stream -> gzip -> age encrypt -> upload
```

Production rule:

- external backup artifacts must be encrypted.
- `none` encryption is allowed only for local/dev targets.

Restore needs the age identity:

```bash
age --decrypt -i age-identity.txt backup.dump.gz.age | gunzip > restore.dump
```

## Retention Policy

Recommended defaults:

```yaml
retention:
  daily: 14
  weekly: 8
  monthly: 6
```

Interpretation:

- keep daily backups for 14 days;
- keep weekly backups for 8 weeks;
- keep monthly backups for 6 months.

The runner can tag cadence at runtime:

```bash
backup-runner backup all --cadence daily
backup-runner backup all --cadence weekly
backup-runner backup all --cadence monthly
```

Retention prune should:

- list manifests by target/prefix;
- group by cadence;
- sort by `createdAt`;
- delete artifact and manifest pairs beyond policy;
- log every deletion.

Do not prune objects that have no valid manifest in phase 1. Unknown objects should be reported, not deleted.

## Verification

Verification levels:

### Upload Verification

After upload:

- run `HeadObject`;
- compare object size;
- compare metadata if available;
- confirm manifest upload.

### Artifact Verification

For latest backup:

- download encrypted artifact to temp;
- decrypt;
- decompress;
- check file is non-empty;
- for PostgreSQL custom format, run:

```bash
pg_restore --list backup.dump
```

### Restore Verification

Manual or scheduled restore test:

```bash
backup-runner restore maintana --latest --output /tmp/maintana.dump
pg_restore --list /tmp/maintana.dump
```

Future mature test:

- restore into disposable local Postgres;
- run a simple query count;
- destroy disposable database.

## Logging

Use structured JSON logs.

Example:

```json
{
  "level": "info",
  "event": "backup.completed",
  "targetId": "maintana",
  "backupId": "maintana-20260518T020000Z-a1b2c3",
  "durationMs": 4212,
  "artifactSizeBytes": 1234567,
  "storageBucket": "maintana-db-backups",
  "storageKey": "maintana/postgres/daily/2026/05/...",
  "createdAt": "2026-05-18T02:00:04.212Z"
}
```

Log destinations:

- stdout for systemd journal;
- optional file in `/var/log/orymu-ops-backup-runner`.

Never log:

- S3 secret keys;
- database passwords;
- age private identity;
- raw `.env` values.

## Notifications

Phase 1 notification:

- Telegram bot message on failure.

Optional:

- Telegram message on success for weekly/monthly only;
- webhook notification;
- email.

Failure message should include:

```text
[Backup Failed]
Target: maintana
Stage: upload
Time: 2026-05-18 02:00 WIB
Error: AccessDenied
Server: orymu-droplet
```

Success message should be optional to avoid alert fatigue.

## Scheduling

Use systemd timer on production servers.

Example service:

```ini
[Unit]
Description=Orymu Backup Runner

[Service]
Type=oneshot
WorkingDirectory=/opt/orymu/ops-backup-runner
EnvironmentFile=/opt/orymu/ops-backup-runner/.env
ExecStart=/usr/bin/node dist/cli.js backup all --cadence daily
```

Example timer:

```ini
[Unit]
Description=Run Orymu backups daily

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Use `Persistent=true` so missed runs execute after server boot.

Weekly/monthly can be separate timers or the runner can decide cadence based on date.

Recommended:

- daily timer at 02:00;
- weekly timer Sunday 02:30;
- monthly timer first day 03:00.

## CLI Commands

### `doctor`

Validates:

- config file exists;
- targets are valid;
- required env variables exist;
- Docker is available for Docker dumpers;
- target containers exist;
- S3 credentials can list or head bucket;
- age binary exists;
- notification config works if enabled.

### `backup`

Runs backup:

```bash
backup-runner backup maintana
backup-runner backup all
backup-runner backup all --cadence daily
backup-runner backup maintana --dry-run
```

Dry run should validate and print intended steps without dumping/uploading.

### `list`

Lists available backups from manifests:

```bash
backup-runner list maintana
backup-runner list maintana --json
```

### `verify`

Verifies latest or selected backup:

```bash
backup-runner verify maintana --latest
backup-runner verify maintana --backup maintana-20260518T020000Z-a1b2c3
```

### `restore`

Downloads/decrypts/decompresses to local file:

```bash
backup-runner restore maintana --latest --output /tmp/maintana.dump
```

The command should not restore directly into production. It prepares a restore artifact and prints explicit next steps.

### `prune`

Applies retention:

```bash
backup-runner prune maintana
backup-runner prune all
backup-runner prune maintana --dry-run
```

## Production Install Model

On Orymu shared server:

```text
/opt/orymu/ops-backup-runner/
  dist/
  config/
    targets.yaml
  secrets/
    age-identity.txt
  .env
```

Permissions:

```text
owner: orymu
mode .env: 600
mode secrets/: 700
mode age-identity.txt: 600
```

Systemd units:

```text
/etc/systemd/system/orymu-backup-daily.service
/etc/systemd/system/orymu-backup-daily.timer
/etc/systemd/system/orymu-backup-weekly.service
/etc/systemd/system/orymu-backup-weekly.timer
/etc/systemd/system/orymu-backup-monthly.service
/etc/systemd/system/orymu-backup-monthly.timer
```

## First Three Project Targets

### Maintana

Known likely target:

```yaml
dumper:
  type: postgresDocker
  container: maintana-postgres
  database: maintana
  username: maintana
```

Storage options:

- preferred: client-owned R2 bucket `maintana-db-backups`;
- acceptable: Orymu-owned R2 bucket with prefix `maintana/postgres`;
- avoid: same public/upload bucket as report photos.

### Orymu Backend

Need discovery:

- database type;
- deployment style;
- container name;
- database name/user;
- whether existing backups exist.

### Kevly

Need discovery:

- database type;
- deployment style;
- container name;
- database name/user;
- whether project is client-owned or Orymu-owned for storage.

## Security Model

### Storage Credentials

Use least privilege per target when possible:

- Maintana token can write/read/delete only Maintana backup bucket;
- Kevly token can write/read/delete only Kevly backup bucket;
- Orymu token can write/read/delete only Orymu backup prefix/bucket.

If R2 token scoping is account-level, document that risk and prefer separate bucket/account for client separation.

### Encryption Keys

Recommended:

- one age recipient for Orymu-operated backups initially;
- future per-client recipient if clients require independent ownership.

Keep age private identity in a secure password manager and on the restore operator machine. The server only needs the public recipient for encryption, not the private key, unless automated verify requires decrypting.

Decision:

- For maximum security, production server stores only public recipient.
- Restore/decrypt happens from an operator machine.
- If server-side verify decrypts backup, server must hold private identity, increasing risk.

Recommended MVP:

- server stores public recipient only;
- upload verification checks object existence;
- manual monthly restore test uses private identity from operator machine.

## Operational Runbook

Daily checks:

```bash
systemctl status orymu-backup-daily.timer
journalctl -u orymu-backup-daily.service -n 100
backup-runner list maintana
```

Manual backup:

```bash
backup-runner backup maintana --cadence manual
```

Manual restore preparation:

```bash
backup-runner restore maintana --latest --output /tmp/maintana.dump
pg_restore --list /tmp/maintana.dump
```

Restore into Postgres:

```bash
createdb maintana_restore
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d maintana_restore /tmp/maintana.dump
```

Production restore should have a separate incident runbook and should not be automated casually.

## Failure Cases

### Database Container Missing

Expected:

- backup fails at `doctor` or dump stage;
- failure notification sent;
- no empty backup uploaded.

### `pg_dump` Fails

Expected:

- backup fails;
- temp files cleaned;
- failure notification includes target and stage;
- no retention prune runs for that target.

### R2 Upload Fails

Expected:

- backup fails after dump/encrypt;
- failure notification sent;
- local temp cleaned unless debug mode is enabled.

### Retention Prune Fails

Expected:

- backup remains successful if upload verification passed;
- prune failure logged as warning or partial failure;
- notification sent depending on policy.

### Notification Fails

Expected:

- backup result remains recorded;
- notification failure logged;
- command exits according to backup outcome, not notification outcome.

### Disk Space Low

Expected:

- `doctor` can warn;
- backup job should fail before dump if temp workspace free space is below configured threshold.

## Testing Strategy

Unit tests:

- config schema validation;
- target secret env resolution;
- retention grouping and prune decisions;
- artifact key generation;
- manifest generation;
- error normalization;
- notification message formatting.

Integration tests:

- local storage adapter;
- fake dumper stream;
- S3 adapter with mocked AWS client;
- backup command with local storage and no encryption;
- prune dry-run.

Server smoke:

- `backup-runner doctor`;
- `backup-runner backup maintana --cadence manual`;
- `backup-runner list maintana`;
- `backup-runner restore maintana --latest --output /tmp/maintana.dump`;
- `pg_restore --list /tmp/maintana.dump`.

Runtime evidence docs should capture:

- command run;
- backup object key;
- manifest key;
- restore verification output;
- notification screenshot or log.

## Implementation Phases

### Phase 1 - Project Bootstrap And Contract

Goal: create the standalone repo and lock the configuration contract.

Tasks:

- create `ops-backup-runner` repo;
- add TypeScript CLI foundation;
- add config schema;
- add example config;
- add docs for concepts and security;
- add baseline tests and verify script.

Acceptance criteria:

- `backup-runner doctor --config config/targets.example.yaml` validates example config shape;
- tests run in CI;
- no raw secrets in config examples.

### Phase 2 - Local Pipeline

Goal: prove the pipeline without external services.

Tasks:

- add fake/test dumper;
- add local storage adapter;
- add gzip compression;
- add manifest writing;
- add list/restore commands for local storage;
- add retention dry-run.

Acceptance criteria:

- can create a local backup artifact;
- can list it;
- can restore it to a file;
- retention dry-run reports expected deletes.

### Phase 3 - PostgreSQL Docker Dumper

Goal: back up Dockerized Postgres databases.

Tasks:

- implement `postgresDocker` dumper;
- stream `pg_dump --format=custom`;
- support container/database/username config;
- add integration smoke against a disposable Postgres container.

Acceptance criteria:

- generated dump passes `pg_restore --list`;
- dump failures are surfaced clearly;
- no plaintext dump remains after job cleanup.

### Phase 4 - S3/R2 Storage

Goal: upload encrypted artifacts to R2 or S3-compatible storage.

Tasks:

- implement S3 storage adapter;
- upload artifact and manifest;
- head object verification;
- list objects by prefix;
- download object for restore;
- delete objects for retention.

Acceptance criteria:

- one target can back up to R2;
- object verification passes;
- restore downloads from R2 and produces valid dump.

### Phase 5 - Encryption

Goal: enforce encrypted external backups.

Tasks:

- implement `age` encryption;
- add public recipient config;
- encrypt before upload;
- restore decrypts with identity path when available;
- block external storage with `encryption: none` unless explicitly allowed for dev.

Acceptance criteria:

- uploaded DB artifacts are encrypted;
- restore with private identity succeeds;
- restore without identity fails clearly.

### Phase 6 - Notifications And Logs

Goal: operational visibility.

Tasks:

- structured JSON logs;
- Telegram failure notification;
- optional success notification;
- include target/stage/error in message;
- avoid secret leakage.

Acceptance criteria:

- failed backup sends Telegram message;
- success notification can be enabled/disabled;
- logs are useful for incident review.

### Phase 7 - Maintana Production Rollout

Goal: deploy the runner for Maintana first.

Tasks:

- install runner on shared server;
- configure Maintana target;
- configure Maintana backup R2 bucket/credentials;
- create age recipient;
- run manual backup;
- restore and verify with `pg_restore --list`;
- enable daily systemd timer.

Acceptance criteria:

- Maintana backup object exists in external storage;
- manifest exists;
- restore test passes;
- timer is active;
- failure notification is tested.

### Phase 8 - Orymu Backend And Kevly Rollout

Goal: add the two existing projects.

Tasks:

- inspect Orymu backend deployment;
- inspect Kevly deployment;
- add target configs;
- run `doctor`;
- run manual backup for each;
- restore verify each;
- include in daily timer.

Acceptance criteria:

- all three projects have daily external encrypted backups;
- each has at least one tested restore artifact;
- runbook documents target-specific restore notes.

### Phase 9 - Hardening

Goal: improve long-term maturity.

Tasks:

- monthly restore-test reminder;
- backup dashboard/report command;
- storage cost estimate command;
- stale backup alert if latest backup age exceeds threshold;
- optional per-target lock to avoid overlapping jobs;
- optional checksum validation after download.

Acceptance criteria:

- operators can see backup health quickly;
- missed backups are detected;
- overlapping backup runs are prevented.

## Recommended First Milestone

Build the runner outside Maintana and use Maintana as the first production target.

First milestone deliverables:

- standalone TypeScript CLI;
- config schema;
- PostgreSQL Docker dumper;
- R2/S3 storage;
- gzip compression;
- age encryption;
- manifest;
- list/restore/doctor commands;
- Telegram failure notification;
- systemd timer;
- Maintana production backup verified by restore listing.

After Maintana is proven, add Orymu backend and Kevly.

## Open Questions

- Should backup ownership be Orymu-owned for all internal/client projects, or client-owned per project?
- Do we need one age key for all projects or per-project/client age recipients?
- Are Orymu backend and Kevly both PostgreSQL?
- Are they Dockerized on the same server or deployed elsewhere?
- Should success notifications be disabled daily and enabled only weekly/monthly?
- Should we use one shared R2 bucket with prefixes or separate buckets per project?
- Should failed backup notifications go to Telegram, WhatsApp, email, or all?

## Recommendation

Use this design:

```text
Standalone backup-runner
PostgreSQL Docker support first
Per-target R2/S3 storage
age encryption
daily/weekly/monthly retention
systemd timers
Telegram failure alerts
restore/list/verify commands from day one
```

This gives us a mature foundation that can support Maintana now and scale to Orymu backend, Kevly, and future client systems without copying fragile backup scripts between projects.
