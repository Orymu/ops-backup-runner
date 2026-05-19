# Ops Backup Runner — Implementation Plan

Status: Draft for execution  
Repository: `Orymu/ops-backup-runner`  
Primary target for first rollout: Maintana production  
Source proposal: `docs/reusable-backup-runner-proposal.md`

## Goal

Build a reusable, production-grade backup runner that can be installed on VPS servers and back up multiple deployed systems.

The first production milestone is:

```text
Maintana PostgreSQL Docker container
  -> pg_dump custom format
  -> gzip
  -> age encrypt
  -> upload to R2/S3
  -> write manifest
  -> verify upload
  -> retention prune
  -> Telegram failure alert
  -> restore/list/verify commands
```

The design must remain reusable for Orymu backend, Kevly, and future projects.

## Non-Negotiable Rules

- Do not couple the runner to Maintana internals.
- Do not require installing the runner as an app dependency.
- Do not store raw secrets in YAML config.
- Do not upload unencrypted production database backups to external storage.
- Do not implement backup without restore/list/verify commands.
- Do not silently skip enabled targets.
- Do not print database passwords, R2 secrets, Telegram tokens, or age private keys.
- Do not claim production readiness without a restore verification.

## Delivery Strategy

Each phase should be small enough to review independently.

Preferred branch flow:

```text
master
  <- feat/project-harness
  <- feat/config-foundation
  <- feat/local-pipeline
  <- feat/postgres-docker-dumper
  <- feat/s3-storage
  <- feat/age-encryption
  <- feat/retention
  <- feat/notifications
  <- feat/systemd-install
  <- feat/maintana-rollout
```

Commit only after the relevant verification command passes.

## Phase 0 — Repo Hygiene And Decision Lock

Status: Done on 18 May 2026.

Goal: make sure we are building the right thing before scaffolding.

Tasks:

- Review `docs/reusable-backup-runner-proposal.md`.
- Confirm first supported production target is PostgreSQL in Docker.
- Confirm first external storage target is S3-compatible storage, specifically Cloudflare R2.
- Confirm encryption default is `age`.
- Confirm first notification channel is Telegram.
- Confirm the runner is installed on target VPS, not inside each app repo.

Acceptance criteria:

- Open questions for MVP are answered.
- No code implementation starts before the MVP boundary is clear.

Decision lock:

- First supported production target: PostgreSQL running in Docker.
- First external storage target: S3-compatible object storage, specifically Cloudflare R2.
- Storage configuration remains per target, so one Cloudflare account with multiple buckets and separate Cloudflare accounts per project are both supported.
- Encryption default: `age`; production database backups must be encrypted before external upload.
- First notification channel: Telegram.
- Installation model: standalone runner installed on the target VPS, not an app dependency inside Maintana, Orymu backend, Kevly, or future projects.
- First rollout target: Maintana production.
- Product boundary: Phase 2 starts with typed configuration and `doctor`; no real backup side effects are introduced before the config foundation is validated.

## Phase 1 — Project Harness

Status: Done on 18 May 2026.

Goal: create a strict engineering harness before implementation.

Tasks:

- Add `package.json`.
- Add TypeScript strict config.
- Add source structure:

```text
src/
  cli.ts
  config/
  core/
  commands/
  dumpers/
  storage/
  encryption/
  notifications/
```

- Add test stack with Vitest.
- Add linting and formatting.
- Add `pnpm verify`.
- Add GitHub Actions CI running `pnpm verify`.
- Add `.env.example`.
- Add `.gitignore`.
- Add README quickstart section.
- Add PR template.
- Add Conventional Commit documentation.

Recommended scripts:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "test": "vitest run",
    "type-check": "tsc --noEmit",
    "verify": "pnpm format:check && pnpm lint && pnpm type-check && pnpm test && pnpm build"
  }
}
```

Acceptance criteria:

- `pnpm verify` passes.
- CI runs `pnpm verify`.
- Repo has no production logic yet.
- README points to proposal and implementation plan.

### Phase 1 Harness Smoke Evidence

Status: Passed on 18 May 2026.

Verification executed:

```bash
pnpm verify
```

Result:

- format, lint, type-check, tests, and build passed;
- architecture harness passed;
- source hygiene harness passed;
- docs harness passed;
- env harness passed;
- project-map harness passed;
- security harness passed;
- commit message harness passed.

Negative smoke tests executed:

```bash
pnpm harness:commit -- --message "bad commit message"
```

Expected failure confirmed:

- invalid commit message was rejected with the required `type(scope): message` format and allowed commit types.

Temporary architecture violation created locally:

```text
src/core/harness-smoke.ts -> src/storage/harness-smoke.ts
```

Expected failure confirmed:

- architecture harness rejected `src/core/**` importing runtime adapter code from `src/storage/**`.

The temporary smoke files were removed after the negative test, and the clean gate passed again. The harness is ready to guard Phase 2 product implementation.

## Phase 2 — Config Foundation

Status: Done on 18 May 2026.

Goal: build typed, validated configuration before any backup behavior.

Tasks:

- Add YAML config loader.
- Add Zod config schema.
- Add env reference resolution helper.
- Add redacted config preview helper.
- Add target selection helper.
- Add initial `doctor` command skeleton.
- Add `config/targets.example.yaml`.

Config must support:

- multiple targets;
- per-target dumper;
- per-target storage;
- per-target retention override;
- default encryption;
- default notification policy;
- env var references for secrets.

Example validation behavior:

- missing config path -> clear error;
- duplicate target ids -> clear error;
- enabled target with missing env reference -> doctor fails;
- unknown dumper/storage/encryption type -> config load fails;
- disabled target can have incomplete credentials but should be reported as disabled.

Acceptance criteria:

- `backup-runner doctor --config config/targets.example.yaml` can validate static config shape.
- Unit tests cover valid config, invalid config, duplicate target ids, and env reference resolution.
- Secrets are redacted in all printed config/debug output.
- `pnpm verify` passes.

Verification evidence:

```bash
pnpm verify
node dist/cli.js doctor --config config/targets.example.yaml
```

Result:

- strict YAML config loading is implemented;
- Zod schema rejects invalid config shape and duplicate target ids;
- env reference resolution reports missing required values for enabled targets;
- disabled targets can validate without production secrets;
- config preview redaction masks secret-shaped keys;
- `doctor` validates config shape without running backup side effects;
- example config validates as a disabled Maintana target.

## Phase 3 — CLI Foundation

Status: Done on 18 May 2026.

Goal: create stable command interfaces with no real backup side effects yet.

Tasks:

- Add CLI command parser.
- Add commands:
  - `doctor`;
  - `backup`;
  - `list`;
  - `verify`;
  - `restore`;
  - `prune`.
- Add `--config`.
- Add `--json` output support for relevant commands.
- Add `--dry-run` where applicable.
- Add standard process exit codes.

Recommended exit codes:

```text
0 success
1 runtime failure
2 config/usage error
3 verification failure
```

Acceptance criteria:

- Every command has help output.
- Unknown target fails clearly.
- `backup all --dry-run` lists enabled targets without executing dump/upload.
- `pnpm verify` passes.

Verification evidence:

```bash
pnpm verify
node dist/cli.js backup all --dry-run --config config/targets.example.yaml
node dist/cli.js backup unknown --dry-run --config config/targets.example.yaml
node dist/cli.js restore --help
```

Result:

- command parser is testable through `runCli(args)`;
- `doctor`, `backup`, `list`, `verify`, `restore`, and `prune` have help output;
- shared `--config` and `--json` handling exists;
- `backup all --dry-run` validates target selection without dump/upload/prune/notification side effects;
- unknown target returns usage exit code `2` with a clear message;
- non-dry-run backup returns runtime exit code `1` until Phase 4 implements the local pipeline;
- placeholder target commands validate target selection and explicitly report that no backup side effects were executed.

## Phase 4 — Local Backup Pipeline

Status: Done on 18 May 2026.

Goal: prove the core pipeline with fake dumper and local storage.

Tasks:

- Add dumper interface.
- Add fake/test dumper.
- Add local storage adapter.
- Add temp workspace management.
- Add artifact naming.
- Add manifest generation.
- Add gzip compression.
- Add `backup` command using fake dumper + local storage.
- Add `list` command for local manifests.
- Add `restore` command for local artifacts.

Local artifact flow:

```text
fake readable stream
  -> gzip
  -> optional encryption none for dev
  -> local storage write
  -> manifest write
```

Acceptance criteria:

- Can run a local backup with fake dumper.
- Can list created backup.
- Can restore created backup to a file.
- Manifest includes target id, created time, artifact key, size, sha256, compression, encryption, storage metadata.
- Temp files are cleaned after success and failure.
- `pnpm verify` passes.

Verification evidence:

```bash
pnpm verify
```

Result:

- `fake` dumper config is supported for local/dev backup targets;
- `local` storage config is supported for local/dev artifact storage;
- backup pipeline writes `fake dump -> gzip -> local artifact -> manifest`;
- manifest includes target id, created time, artifact key, size, sha256, compression, encryption, and storage metadata;
- `list` reads local manifests;
- `verify --latest` checks local artifact sha256 against the manifest;
- `restore` gunzips the stored artifact into the requested output file;
- temp workspace cleanup is handled in the backup job finalizer;
- real PostgreSQL, S3/R2, age encryption, retention pruning, and notifications remain intentionally outside Phase 4.

## Phase 5 — PostgreSQL Docker Dumper

Status: Done on 18 May 2026.

Goal: back up Dockerized PostgreSQL databases.

Tasks:

- Add `postgresDocker` dumper.
- Build safe `docker exec` process invocation.
- Stream `pg_dump` stdout into pipeline.
- Capture stderr for failure logs.
- Support:
  - container;
  - database;
  - username;
  - format `custom`;
  - optional docker binary path.
- Add integration test using a disposable Postgres container if practical.
- Add `doctor` checks:
  - docker binary exists;
  - target container exists;
  - `pg_dump` command can run.

Dump command shape:

```bash
docker exec <container> pg_dump \
  -U <username> \
  -d <database> \
  --format=custom \
  --no-owner \
  --no-privileges
```

Acceptance criteria:

- Dump output passes `pg_restore --list`.
- Failed container/database/user produces clear error.
- No plaintext dump is left behind after backup.
- `pnpm verify` passes.

Verification evidence:

```bash
pnpm verify
```

Result:

- `postgresDocker` dumper is implemented behind the shared dumper port;
- safe `docker exec ... pg_dump` argument construction is unit tested;
- optional `dockerBinary` and `pgRestoreBinary` are supported in config;
- optional `passwordEnv` is passed to Docker as `--env PGPASSWORD` without putting the secret value in command arguments;
- dump stdout is captured as bytes and passed into the existing gzip/local backup pipeline;
- `pg_restore --list` validates the custom dump from stdin before the artifact is accepted;
- docker failures and invalid dump verification failures produce clear target-specific errors;
- doctor checks validate docker binary availability, container existence, and `pg_dump --version` inside the container for enabled `postgresDocker` targets;
- no plaintext dump file is written by the dumper or backup job.

Integration note:

- Disposable Postgres container coverage was not added in this phase because the unit suite uses mocked process runners and must stay stable without Docker availability in CI. A real-container test can be added later behind an explicit integration-test command.

## Phase 6 — S3/R2 Storage Adapter

Status: Done on 18 May 2026.

Goal: support Cloudflare R2 and generic S3-compatible storage.

Tasks:

- Add S3 storage adapter with AWS SDK v3.
- Resolve per-target storage env values.
- Implement:
  - upload object;
  - head object;
  - list objects by prefix;
  - delete object;
  - download object.
- Add object metadata where useful:
  - target id;
  - backup id;
  - created at;
  - sha256.
- Add upload verification after artifact and manifest upload.
- Add tests with mocked S3 client.

Must support:

- same R2 account with different buckets;
- same R2 account with shared bucket and per-project prefixes;
- different R2 accounts per project;
- different credentials per project.

Acceptance criteria:

- Adapter can upload/download/head/list/delete using mocked S3 client.
- Config supports per-target endpoint/bucket/prefix/credentials.
- `doctor` can validate storage config without printing secrets.
- `pnpm verify` passes.

Verification evidence:

```bash
pnpm verify
```

Result:

- S3-compatible storage adapter is implemented with AWS SDK v3;
- adapter supports upload, head, list-by-prefix, download, and delete operations;
- artifact upload verifies object size with `HeadObject`;
- manifest upload verifies object size with `HeadObject`;
- object metadata includes target id, backup id, created time, and sha256 where relevant;
- key generation supports per-target prefixes for shared buckets;
- config already supports per-target endpoint, bucket, prefix, and credential env references;
- doctor validates missing S3 credential env references through the existing env resolution path without printing secret values;
- tests use a mocked S3 client and do not require real Cloudflare R2 credentials.

## Phase 7 — Age Encryption

Status: Done on 18 May 2026.

Goal: encrypt backups before external upload.

Tasks:

- Add encryption interface.
- Add `none` encryption for local/dev only.
- Add `age` encryption adapter.
- Support age recipient from env.
- Support age identity path for restore.
- Add production guard:
  - external storage + `none` encryption fails unless explicit unsafe override is set.
- Add restore decrypt path.

Pipeline:

```text
pg_dump stream
  -> gzip
  -> age encrypt
  -> upload
```

Restore:

```text
download
  -> age decrypt
  -> gunzip
  -> output dump file
```

Acceptance criteria:

- External backup artifact is encrypted.
- Restore with age identity produces a valid dump.
- Restore without required identity fails clearly.
- `none` encryption is blocked for production external storage.
- `pnpm verify` passes.

Verification evidence:

```bash
pnpm verify
```

Result:

- encryption is modeled as a core pipeline port;
- `none` encryption is implemented for local/dev use;
- `age` encryption adapter is implemented with a process runner and mocked tests;
- backup pipeline now applies encryption after gzip and before storage;
- restore path decrypts before gunzip;
- age recipient is resolved from env for backup encryption;
- age identity path is resolved from env for restore decryption;
- missing identity fails clearly before restore can proceed;
- external storage with `encryption: none` is blocked unless `allowUnsafeExternal: true` is explicitly set;
- external-storage encryption guard is included in doctor validation;
- tests cover encrypted artifact storage, restore decrypt path, age command arguments, missing identity failure, and unsafe external storage guard.

## Phase 8 — Retention Engine

Status: Done on 19 May 2026.

Goal: remove old backups safely.

Tasks:

- Add retention policy model:
  - daily;
  - weekly;
  - monthly;
  - manual.
- Add manifest parser.
- Add prune planner.
- Add `prune --dry-run`.
- Add deletion execution.
- Delete only manifest-backed artifact pairs.
- Never delete unknown objects in Phase 1.

Retention logic:

```text
list manifests by target/prefix
group by cadence
sort by createdAt desc
keep N according to policy
delete older artifact + manifest pairs
```

Acceptance criteria:

- Unit tests cover retention edge cases.
- Dry-run prints intended deletions without deleting.
- Unknown objects are reported but not deleted.
- Prune failure does not mark backup upload as failed if backup already succeeded.
- `pnpm verify` passes.

Verification evidence:

```bash
pnpm verify
```

Result:

- retention policy now supports daily, weekly, monthly, max-age, and manual keep rules;
- local storage can list object keys and delete specific keys for prune execution;
- retention planner keeps selected manifest-backed backups and plans only expired artifact/manifest pairs for deletion;
- unknown objects are reported in prune output and are never deleted;
- `prune --dry-run` prints intended deletions without deleting files;
- `prune` execution deletes only manifest-backed artifact and manifest pairs;
- unsupported external storage targets fail clearly instead of pruning blindly;
- tests cover planner edge cases, dry-run safety, execution deletion safety, and unsupported storage behavior.

## Phase 9 — Verification Commands

Status: Done on 19 May 2026.

Goal: make restore confidence operationally visible.

Tasks:

- Implement `verify <target> --latest`.
- Download latest artifact.
- Decrypt if needed.
- Decompress.
- For Postgres custom dumps, run:

```bash
pg_restore --list <dump-file>
```

- Add checksum verification against manifest.
- Clean temp files after verification.

Acceptance criteria:

- `verify --latest` fails if no backups exist.
- `verify --latest` succeeds for valid Postgres custom dump.
- Corrupted artifact fails checksum or restore-list verification.
- `pnpm verify` passes.

Verification evidence:

```bash
pnpm verify
```

Result:

- `verify --latest` now fails clearly when no backups exist;
- verification checks artifact checksum against the manifest;
- verification decrypts and decompresses the artifact before declaring success;
- PostgreSQL Docker targets run `pg_restore --list <dump-file>` against a temporary restored dump;
- temporary restore-list files are cleaned up after verification;
- corrupted artifacts fail verification before restore-list execution;
- invalid PostgreSQL dump content fails restore-list verification;
- tests cover empty targets, checksum mismatch, restore-list success, restore-list failure, and existing backup/list/restore flow.

## Phase 10 — Notifications

Goal: alert operators when backup fails.

Tasks:

- Add notification interface.
- Add Telegram notifier.
- Add notification policy:
  - success optional;
  - failure enabled by default;
  - weekly/monthly success optional.
- Add secret-safe error formatting.
- Add notification test command or `doctor` check.

Failure message should include:

```text
[Backup Failed]
Target: maintana
Stage: upload
Time: 2026-05-18 02:00 WIB
Error: AccessDenied
Server: orymu-droplet
```

Acceptance criteria:

- Failed backup sends Telegram alert when configured.
- Missing Telegram config fails `doctor` if notifications are enabled.
- Notification failure is logged but does not hide the original backup failure.
- `pnpm verify` passes.

## Phase 11 — Systemd Install Assets

Goal: make server installation repeatable.

Tasks:

- Add systemd service templates:
  - daily;
  - weekly;
  - monthly.
- Add install docs.
- Add production directory layout docs.
- Add `.env.example` for production.
- Add `doctor` command to validate installed server environment.

Production layout:

```text
/opt/orymu/ops-backup-runner/
  dist/
  config/
    targets.yaml
  secrets/
  .env
```

Acceptance criteria:

- Docs explain install path, permissions, and timer activation.
- Systemd files use `EnvironmentFile`.
- `Persistent=true` is documented for timers.
- `pnpm verify` passes.

## Phase 12 — Maintana Production Rollout

Goal: prove production value on the first real system.

Tasks:

- Create or select R2 backup bucket/prefix for Maintana.
- Create backup R2 credentials.
- Create age recipient.
- Install runner on Orymu VPS.
- Configure Maintana target:

```yaml
id: maintana
dumper:
  type: postgresDocker
  container: maintana-postgres
  database: maintana
  username: maintana
```

- Run:

```bash
backup-runner doctor
backup-runner backup maintana --cadence manual
backup-runner list maintana
backup-runner restore maintana --latest --output /tmp/maintana.dump
pg_restore --list /tmp/maintana.dump
```

- Enable daily timer.
- Record runtime evidence.

Acceptance criteria:

- Maintana backup exists in external R2/S3 storage.
- Manifest exists.
- Restore artifact passes `pg_restore --list`.
- Timer is active.
- Failure notification is tested.
- Runtime evidence is documented.

## Phase 13 — Orymu Backend And Kevly Rollout

Goal: bring the other current systems under the same backup platform.

Tasks:

- Inspect Orymu backend deployment:
  - database type;
  - container name;
  - database name;
  - database user;
  - current backup situation.
- Inspect Kevly deployment with the same checklist.
- Add targets.
- Run `doctor`.
- Run manual backups.
- Verify restores.
- Enable scheduled backup for both.

Acceptance criteria:

- Maintana, Orymu backend, and Kevly each have at least one verified external backup.
- All three are included in scheduled backups.
- Target-specific restore notes are documented.

## Phase 14 — Hardening Backlog

Do only after the first production rollout is reliable.

Potential improvements:

- lock file per target to prevent overlapping backups;
- stale backup alert if latest successful backup is older than threshold;
- backup health report command;
- restore into disposable Postgres database;
- storage cost estimate command;
- multiple notification channels;
- MySQL/MariaDB dumper;
- Postgres URL dumper for managed databases;
- remote SSH dumper for operator/local mode;
- GitHub release packaging;
- binary distribution with `pkg` or similar if useful.

## Verification Matrix

| Phase            | Required Verification                              |
| ---------------- | -------------------------------------------------- |
| Harness          | `pnpm verify`, CI green                            |
| Config           | unit tests for schema/env resolution               |
| CLI              | command help and invalid target tests              |
| Local pipeline   | local backup/list/restore smoke                    |
| Postgres Docker  | `pg_restore --list` on generated dump              |
| S3/R2            | mocked adapter tests, real R2 smoke before rollout |
| Age              | encrypted artifact restore smoke                   |
| Retention        | dry-run and deletion planner tests                 |
| Notifications    | mocked Telegram tests, real failure alert smoke    |
| Systemd          | `systemctl status`, timer active                   |
| Maintana rollout | external object exists, restore verified           |

## First Implementation Cut

The first code milestone should stop at local pipeline:

```text
Phase 1 - Project Harness
Phase 2 - Config Foundation
Phase 3 - CLI Foundation
Phase 4 - Local Backup Pipeline
```

This gives us a clean foundation before touching Docker, R2, encryption, or production.

After that, implement production behavior in this order:

```text
Postgres Docker -> S3/R2 -> age -> retention -> notifications -> systemd -> Maintana rollout
```

## Current Stop Point

This file is the execution plan. No implementation has started yet.

Next recommended action:

```text
Start Phase 1 on a feature branch and build the project harness.
```
