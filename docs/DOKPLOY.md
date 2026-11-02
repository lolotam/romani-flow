# Deploying ROMANI Flow on Dokploy

The application runs as a **single container** that serves both the API and the
built SPA. Everything that must survive a redeploy — the SQLite database and
every uploaded file — lives in **one directory on the host**, mounted into the
container. That directory is the "bucket".

---

## 1. What lives where

| Path | Inside the container | On the host |
|---|---|---|
| Application code | `/app` | image layer (rebuilt on deploy) |
| SPA assets | `/app/dist` | image layer |
| API server | `/app/server-dist` | image layer |
| **SQLite database** | `/data/romani.db` | `/opt/romani/data/romani.db` |
| **Uploaded files** | `/data/uploads/YYYY/MM/…` | `/opt/romani/data/uploads/YYYY/MM/…` |

Only `/data` is persistent. Everything else is disposable.

---

## 2. Prepare the host

Run this **once** on the Dokploy host:

```bash
sudo mkdir -p /opt/romani/data/uploads
sudo chown -R 1001:1001 /opt/romani/data     # 1001 is the uid the container runs as
sudo chmod -R 750 /opt/romani/data

# The marker file proves at boot that the volume is really mounted.
sudo touch /opt/romani/data/.romani-volume
sudo chown 1001:1001 /opt/romani/data/.romani-volume
```

> **Why the marker matters.** The container creates `/data` itself when it is
> missing, so a writable directory proves nothing. The application refuses to
> start in production unless `/data/.romani-volume` exists — that file can only
> come from the host, so its presence means the volume is mounted. Without this
> check a missing mount silently discards the database on the next rebuild.

The host must have a filesystem that supports **file locking** for SQLite WAL.
A normal ext4/xfs disk is fine. Do **not** put the database on NFS, a network
share, or an object-storage mount — SQLite needs proper `fcntl` locking there.

---

## 3. Create the application in Dokploy

1. **Dokploy → Projects → Create Project** → name it `romani`.
2. **Create Application → Dockerfile** (or "Compose" if you prefer the file below).
3. Point the build context at the repository root (`romani-flow`) and leave the
   Dockerfile as `Dockerfile`.
4. **Domain**: add the domain you want, e.g. `romani.curemed.iq`. Traefik
   terminates TLS and routes it to the container's port `3000`.

### Using the compose file instead

Paste `docker-compose.yml` from this repository into the Dokploy compose editor
and set the environment variables there. The volume is declared as:

```yaml
volumes:
  - ${ROMANI_DATA_DIR:-/opt/romani/data}:/data
```

---

## 4. Mount the bucket (the important step)

In Dokploy, open the application → **Mounts** (or *Volumes*) → **Add Mount**:

| Field | Value |
|---|---|
| Type | **Bind** |
| Source | `/opt/romani/data` |
| Destination | `/data` |
| Read/Write | **rw** |

That single mount gives the container both the database and the file bucket.
If you prefer to keep large files on a different disk, add a second mount:

| Type | Source | Destination |
|---|---|---|
| Bind | `/opt/romani/data` | `/data` |
| Bind | `/mnt/bigdisk/romani-uploads` | `/data/uploads` |

and set `UPLOADS_DIR=/data/uploads` (the default).

**Never mount the uploads directory into the SPA's static folder** — files are
served only through the authenticated API endpoints, so they stay private.

---

## 5. Environment variables

Add these in Dokploy → the application → **Environment** (mark the secrets as
sensitive so they are masked in the UI):

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `JWT_SECRET` | *(random, ≥ 32 chars)* | `openssl rand -base64 48` — **required**, the app refuses to boot without it |
| `DATA_DIR` | `/data` | the mount point |
| `UPLOADS_DIR` | `/data/uploads` | the bucket |
| `TZ` | `Asia/Kuwait` | the timezone the daily reminder fires in |
| `SMTP_HOST` | `smtp.gmail.com` | |
| `SMTP_PORT` | `587` | use `465` with `SMTP_SECURE=true` |
| `SMTP_SECURE` | `false` | |
| `SMTP_USER` | `samirfayez03@gmail.com` | the sender account |
| `SMTP_PASS` | *(Gmail app password)* | see below |
| `SMTP_FROM` | `ROMANI Flow <samirfayez03@gmail.com>` | |
| `MAX_UPLOAD_MB` | `25` | |
| `MAX_EMAIL_ATTACHMENT_MB` | `20` | keeps the message under Gmail's 25 MB ceiling |

### The Gmail app password

The sender account needs an **app password**, not its account password:

1. Sign in to `samirfayez03@gmail.com` with 2-Step Verification enabled.
2. Open <https://myaccount.google.com/apppasswords>.
3. Create an app password named `ROMANI Flow`.
4. Copy the 16-character password into `SMTP_PASS` in Dokploy.

The password stays in the environment. It is **never** written to the database
and is never returned by the API — the Settings screen only shows whether SMTP
is configured.

---

## 6. First boot

Deploy and watch the logs. A healthy first boot prints:

```
[server] environment : production
[server] data dir    : /data
[server] applied migrations: 001_init.sql, 002_indexes.sql, 003_expiry_notifications.sql, 004_pending_uploads.sql
[server] imported seed data: companies=2, ministries=5, document_types=8, positions=6, employees=20, documents=3
[server] created admin accounts: dr.vet.waleedtam@gmail.com, Room_samer20105@yahoo.com
[server] listening on http://0.0.0.0:3000
```

Then check:

```bash
curl -fsS https://romani.curemed.iq/api/health
# {"status":"healthy","database":"ok","smtp":true,"timestamp":"…"}
```

Sign in at the domain with either seeded account:

| Email | Password |
|---|---|
| `dr.vet.waleedtam@gmail.com` | `@Xx123456789xX@` |
| `Room_samer20105@yahoo.com` | `@Xx123456789xX@` |

> Change these passwords from the server after the first login if the accounts
> are shared. The seed never overwrites an existing account.

---

## 7. Configure the reminders

In **Settings**:

1. **Email** → add every recipient address in *Recipients* (several can be
   added) and optionally a CC list.
2. **Email → notification intervals** → tick the thresholds you want:
   *3 months before*, *1 month before*, *15 days before*, *1 week before*,
   *1 day before*. Any combination can be active; an item is notified once per
   selected threshold.
3. **Cron** → set the daily time (default `0 8 * * *`, i.e. 08:00 in `TZ`) and
   the look-ahead window, then press **Run now** to send the first report
   immediately. The button reports the real outcome — `sent`, `skipped` with a
   reason, or the error.

The report is sent in Arabic by default, right-to-left, in the same teal
palette as the application. Set `email.language` to `en` for an English report.

Every attempt is recorded and can be reviewed in **Settings → Email → recent
sends**.

---

## 8. Backup and restore

The JSON export in Settings contains the **database records only** — not the
uploaded files. A restorable backup is a copy of the whole storage root:

```bash
# On the host — stop the app first so the database is consistent
cd /opt/romani
sudo systemctl stop romani-flow        # or: docker compose stop app
sudo tar czf romani-backup-$(date +%F).tgz -C /opt/romani data
sudo systemctl start romani-flow
```

Restoring:

```bash
sudo systemctl stop romani-flow
sudo rm -rf /opt/romani/data
sudo tar xzf romani-backup-2026-11-02.tgz -C /opt/romani
sudo chown -R 1001:1001 /opt/romani/data
sudo systemctl start romani-flow
curl -fsS https://romani.curemed.iq/api/health
```

The three seeded documents point at files that lived in the old Supabase
storage and were never imported. They appear in the app without an attachment —
upload the real file to complete them.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The app exits with *"The persistent volume is not mounted"* | The bind mount is missing or points somewhere else | Add the mount `/opt/romani/data → /data` and create `.romani-volume` on the host |
| `SQLITE_BUSY` / "database is locked" | The volume is on a filesystem without proper locking | Move `/data` to a local disk |
| Login always fails | The seeded accounts were not created because the database already had data | Check the logs; create the account from the server console or wipe the volume |
| The expiry email never arrives | SMTP is not configured, or Gmail rejected the sender | Check `SMTP_PASS`, then press **Test connection** in Settings |
| The email arrives but is empty | No item falls into a selected interval | Tick more intervals, or widen `cron.days` |
| Uploads fail with 413 | The file is larger than `MAX_UPLOAD_MB` | Raise the limit and restart |
| Everything disappeared after a redeploy | The volume was not mounted | Add the mount — this is what the `.romani-volume` check prevents |
