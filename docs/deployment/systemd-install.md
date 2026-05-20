# Systemd Install Guide

This guide installs `ops-backup-runner` as a standalone VPS tool. It is not installed inside application repositories.

## Production Layout

Use this layout on the target server:

```text
/opt/orymu/ops-backup-runner/
  dist/
    cli.js
  config/
    targets.yaml
  secrets/
    age-identity.txt
  .env
```

Recommended ownership:

```bash
sudo useradd --system --home /opt/orymu/ops-backup-runner --shell /usr/sbin/nologin ops-backup
sudo mkdir -p /opt/orymu/ops-backup-runner/{config,secrets,dist}
sudo chown -R ops-backup:ops-backup /opt/orymu/ops-backup-runner
sudo chmod 750 /opt/orymu/ops-backup-runner
sudo chmod 700 /opt/orymu/ops-backup-runner/secrets
```

The `ops-backup` user must be able to run Docker commands for PostgreSQL Docker backups. On small VPS deployments this usually means adding it to the `docker` group:

```bash
sudo usermod -aG docker ops-backup
```

That is operationally convenient but grants broad Docker access. Use it only on trusted single-tenant servers.

## Build And Copy

Build locally or in CI:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm build
```

Copy the built runtime, config, and env template to the server:

```bash
sudo rsync -a dist/ /opt/orymu/ops-backup-runner/dist/
sudo rsync -a config/targets.example.yaml /opt/orymu/ops-backup-runner/config/targets.yaml
sudo rsync -a deploy/.env.production.example /opt/orymu/ops-backup-runner/.env
sudo chown -R ops-backup:ops-backup /opt/orymu/ops-backup-runner
sudo chmod 600 /opt/orymu/ops-backup-runner/.env
```

Edit `/opt/orymu/ops-backup-runner/config/targets.yaml` and `/opt/orymu/ops-backup-runner/.env` with production values.

## Validate Install

Run `doctor` with the production install directory:

```bash
sudo -u ops-backup node /opt/orymu/ops-backup-runner/dist/cli.js doctor \
  --config /opt/orymu/ops-backup-runner/config/targets.yaml \
  --install-dir /opt/orymu/ops-backup-runner
```

The install check requires:

- `dist/cli.js`;
- `config/targets.yaml`;
- `secrets/`;
- `.env`.

`doctor` also validates required environment references for enabled targets.

## Install Timers

Copy the systemd units:

```bash
sudo cp deploy/systemd/ops-backup-runner-*.service /etc/systemd/system/
sudo cp deploy/systemd/ops-backup-runner-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

Each service uses:

```ini
EnvironmentFile=/opt/orymu/ops-backup-runner/.env
```

Each timer uses:

```ini
Persistent=true
```

`Persistent=true` makes systemd run a missed backup after the server comes back online.

Enable only the schedules you actually want. For the first Maintana rollout, daily is enough:

```bash
sudo systemctl enable --now ops-backup-runner-daily.timer
sudo systemctl list-timers 'ops-backup-runner-*'
```

## Manual Runtime Checks

Run a manual backup before enabling the timer:

```bash
sudo -u ops-backup node /opt/orymu/ops-backup-runner/dist/cli.js backup all \
  --config /opt/orymu/ops-backup-runner/config/targets.yaml
```

Then verify the latest backup:

```bash
sudo -u ops-backup node /opt/orymu/ops-backup-runner/dist/cli.js verify all \
  --latest \
  --config /opt/orymu/ops-backup-runner/config/targets.yaml
```

For production acceptance, also restore one backup to a temporary file and run `pg_restore --list` against it.
