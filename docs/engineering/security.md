# Security

This repository handles backup infrastructure. Security mistakes can expose production databases or destroy recovery capability.

## Secret Rules

Never commit:

- `.env`;
- private keys;
- age identity files;
- service account JSON;
- R2/S3 credentials;
- Telegram bot tokens;
- database dumps;
- encrypted backup artifacts.

`.gitignore` blocks common secret and backup artifact patterns. Do not bypass it.

## Environment Access

Raw `process.env` access belongs in the config/env loading boundary only.

All other modules should receive typed config.

## Encryption

Production external backups must be encrypted before upload.

Default encryption target:

```text
age
```

Allowed unsafe behavior:

- `encryption: none` for local development only;
- never default for external production storage.

## External Storage

The runner must support per-target storage credentials.

Recommended:

- separate bucket or prefix per project;
- least-privilege R2/S3 token when possible;
- client-owned storage for sensitive client projects;
- encrypted artifacts even when buckets are private.

## Logging

Logs must not include:

- database passwords;
- S3/R2 secret keys;
- Telegram bot tokens;
- private keys;
- full raw env dumps.

Logs may include:

- target id;
- stage;
- duration;
- artifact size;
- storage bucket;
- storage key;
- redacted error message.

## Retention And Deletion Safety

Retention is destructive and high risk.

Rules:

- delete only manifest-backed artifact pairs;
- support dry-run;
- never delete unknown objects in the first implementation;
- log every planned and executed deletion.

## Restore Safety

Restore commands should prepare artifacts and print next steps. They should not overwrite production databases automatically.

Production restore should remain an explicit incident-response workflow.

## Dependency Security

The default harness should include dependency audit checks once Phase H3 adds harness scripts.

Security failures should be actionable, not hidden.
