# Deploying ROMANI Flow on Dokploy

For [WhatsApp reminders](WHATSAPP.md), merging main would apply additive migration007
at startup. Keep the channel disabled and obtain the migration/release disposition
before merge; QR/status approval alone does not permit reminder activation.

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
4. **Domain**: use `romani.curemedkw.com` for this reviewed release. WhatsApp admin
   writes use the server-fixed public origin `https://romani.curemedkw.com`.
   Another domain requires a reviewed origin-policy change, not browser-supplied
   Host/forwarded-header authority. Traefik
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
| `SMTP_HOST` | `smtp.gmail.com` | |
| `SMTP_PORT` | `587` | use `465` with `SMTP_SECURE=true` |
| `SMTP_SECURE` | `false` | |
| `SMTP_USER` | *(required, no default)* | the sender account |
| `SMTP_PASS` | *(Gmail app password)* | see below |
| `SMTP_FROM` | *(required, no default)* | e.g. `ROMANI Flow <sender@example.com>` |
| `MAX_UPLOAD_MB` | `25` | |
| `MAX_EMAIL_ATTACHMENT_MB` | `20` | keeps the message under Gmail's 25 MB ceiling |

Timezone is optional: leave `TZ` **unset** for the current direct deployment;
the read-only runtime check found no TZ override and resolved `UTC`. Do not add
a literal `unset` value or descriptive prose as an environment value. Compose's
separate default is the valid IANA name `Asia/Kuwait`. Preserve any existing
verified override in other deployments; changing timezone changes reminder times
and requires an explicit operating decision.

### The Gmail app password

The sender account needs an **app password**, not its account password:

1. Sign in to the sender account (`SMTP_USER`) with 2-Step Verification enabled.
2. Open <https://myaccount.google.com/apppasswords>.
3. Create an app password named `ROMANI Flow`.
4. Copy the 16-character password into `SMTP_PASS` in Dokploy.

The password stays in the environment. It is **never** written to the database
and is never returned by the API — the Settings screen only shows whether SMTP
is configured.

---

## 6. First boot

The image builds without `data/seed.json` and contains no seed payload. An empty
database starts with empty business tables when no seed file is mounted. To import
an owner-approved seed on first boot, prepare it through a private transfer and
mount that file read-only at `/app/data/seed.json`. Never commit a personal-data
seed or copy it into the image. Review the import and administrator bootstrap
before starting the backend; normal startup migrates, seeds and arms the scheduler.

After the separately approved release, deploy and watch the logs. The following
is an illustrative fresh-install log for the reminder release, with a separately
approved seed mounted; it does not claim production migration `007` has run:

```
[server] environment : production
[server] data dir    : /data
[server] applied migrations: 001_init.sql, 002_indexes.sql, 003_expiry_notifications.sql, 004_pending_uploads.sql, 005_notification_identity.sql, 006_form_defaults.sql, 007_whatsapp_notifications.sql
[server] imported seed data: companies=2, ministries=5, document_types=8, positions=6, employees=20, documents=3
[server] created admin accounts: <the addresses you put in ADMIN_SEED_EMAILS>
[server] listening on http://0.0.0.0:3000
```

Then check:

```bash
curl -fsS https://romani.curemedkw.com/api/health
# {"status":"healthy","database":"ok","smtp":true,"timestamp":"…"}
```

Sign in at the domain with one of the addresses you set in `ADMIN_SEED_EMAILS`
and the password you set in `ADMIN_SEED_PASSWORD` (at least 12 characters). Both
exist only in the Dokploy environment; there is no default account or password.

> The seed never overwrites an existing account. If the log shows
> `no administrator exists`, one of the two variables is missing: set it and
> redeploy.

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

The Settings JSON export omits attachment bytes and account password hashes. It
is not a complete recovery set. Use the checked-out release's host recovery CLI,
as documented in [OPERATIONS.md](OPERATIONS.md#full-recovery-set):

```bash
# On the host: replace this with the actual approved release checkout path.
RELEASE_DIR=/absolute/path/to/approved-release
cd "$RELEASE_DIR" || exit 1
test -r scripts/recovery.py || exit 1
# sudo is required here to read the private data tree and write below /root.
sudo python3 scripts/recovery.py backup --data-dir /opt/romani/data --output /root/romani-backup-UNIQUE
sudo python3 scripts/recovery.py verify --backup /root/romani-backup-UNIQUE
sudo python3 scripts/recovery.py restore --backup /root/romani-backup-UNIQUE --target /root/romani-isolated-restore-UNIQUE
```

For the separate uploads bind in section 4, add
`--uploads-dir /mnt/bigdisk/romani-uploads` to the **backup** command. For a
`DB_PATH` override, add `--db /actual/host/path/database.sqlite`. Use verified
host paths, not container paths. See OPERATIONS.md for the restored layout.

Choose new private directories. The CLI verifies the SQLite snapshot, referenced
attachments, hashes and foreign keys, and refuses an existing restore target.
Never remove or extract an archive over the live data tree merely to prove
recovery. The former delete-and-extract tar procedure is not permitted for
production restore. Promoting an isolated restored instance requires a separate
explicit deployment decision; it is not part of these verification commands.

Before testing the normal production entrypoint on that isolated copy, follow
OPERATIONS.md's verified-target/bind-mount checks, isolated uid/gid ownership,
manual `.romani-volume` preparation and network/SMTP/cron isolation. Do not create
a marker on an unverified mount or bypass the production volume guard. Keep the
source backup, live database and rollback/KEEP assets intact.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The app exits with *"The persistent volume is not mounted"* | The bind mount is missing or points somewhere else | Verify the expected existing production data directory and actual bind source/destination before repairing the mount. Never create a marker merely to bypass startup. For a separate isolated restore, follow the verified-target procedure in [OPERATIONS.md](OPERATIONS.md#full-recovery-set). |
| `SQLITE_BUSY` / "database is locked" | The volume is on a filesystem without proper locking | Move `/data` to a local disk |
| Login always fails | Credentials, inactive account or incomplete approved bootstrap | Check sanitized auth/bootstrap logs and use the owner-approved account recovery process; never wipe the data volume to fix login |
| The expiry email never arrives | SMTP is not configured, or Gmail rejected the sender | Check `SMTP_PASS`, then press **Test connection** in Settings |
| The email arrives but is empty | No item falls into a selected interval | Tick more intervals, or widen `cron.days` |
| Uploads fail with 413 | The file is larger than `MAX_UPLOAD_MB` | Raise the limit and restart |
| Everything disappeared after a redeploy | The volume was not mounted | Add the mount — this is what the `.romani-volume` check prevents |
