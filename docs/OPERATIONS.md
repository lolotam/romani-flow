# Romani Flow operating guide

## Deployment and identity

Production is the Dockerfile/direct Node deployment at https://romani.curemedkw.com.
The API and SPA share port 3000 behind the proxy. The persistent host directory
`/opt/romani/data` mounts at `/data`; preserve `.romani-volume`, `romani.db` and
`uploads`. A green HTTP health response does not prove the latest build deployed:
record the running image ID, update completion, new container health and compiled
asset hashes. Merging `main` auto-deploys. Keep the pre-PR4 rollback tag and all KEEP
assets; never remove an image merely because a newer image exists.

SMTP and JWT credentials come from the deployment's private environment. Never
place passwords, tokens, database exports or real attachments into Git or chat.
Gmail uses `smtp.gmail.com`, port 465 with implicit TLS (`SMTP_SECURE=true`) or
587 with STARTTLS (`SMTP_SECURE=false`). `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and
`SMTP_FROM` must form a complete configuration; account/admin policy determines
whether an app password is available. Do not reuse or rotate credentials without
owner authorization.

## Daily document workflow

1. Sign in with the designated account. Confirm its permissions. Read-only users
   may view authorized data; only administrators may mutate records, files,
   operational schedules or trigger mail.
2. Configure real bilingual company, ministry and document-type catalogs before
   uploading documents. An empty catalog is a setup prerequisite, not an upload
   success. Add employees before selecting an employee beneficiary.
3. Upload a supported PDF/JPEG/PNG within the form's 20 MB limit. Choose company
   or employee, type and applicable ministry. Enter title and expiry date; expiry
   cannot precede issue date. If selecting Other, provide an entity name.
4. Save. Field errors and the general validation toast identify corrections before
   an upload starts. A staging success alone does not prove document persistence.
5. Reopen the saved document, check metadata, download it and verify the file.
   Record ID and file bytes must survive refresh/re-login. Last-successful form
   defaults are account-specific across devices; uploaded bytes and record IDs
   are not reused. Editing does not replace the remembered creation.
6. Log out on shared devices. Do not store credentials in the browser during tests.

For readiness checks use only the owner's designated account/recipient and the
single authorized, clearly labeled PDF record. Record its exact ID and delete only
that record after evidence is captured. Never bulk-erase to clean up a test.

## Mail and reminders

Settings contains SMTP configuration status, explicit recipient list, intervals,
preview and attempt logs. Verify the designated recipient before each controlled
send. Never use a customer address as a test destination. SMTP connection verify
does not send a message; relay acceptance does not establish inbox delivery.
For live proof match the designated inbox receipt to subject, timestamp and
message identity where available. Record rejection, partial or unknown outcomes
honestly; do not label them delivered.

Document sends should report attachment count/bytes and durable attempts.
An attempt left in `sending` after a crash has an unknown outcome: inspect the
designated mailbox/relay before retrying to avoid duplicates. Failed reminders
remain retryable; a successful automated day is deduplicated. Selection is based
on enabled intervals and due dates, not on the mere existence of a document.

The scheduler runs inside the single API process. It uses the process timezone;
the observed production schedule is `0 8 * * *` with next execution reported as
08:00 UTC (11:00 Kuwait) at the readiness check. Preserve this cadence/timezone
unless the owner requests a change. The API next-run value comes from the actual
scheduler, not a hand-calculated daily estimate. A manual report is not proof that
the scheduler fired. An accelerated isolated timer test proves local scheduler
execution only; record production observations separately.

## Full recovery set

The Settings JSON export is useful for inspecting business data but contains no
attachment bytes or password hashes. UI restore and automatic backup switches
are marked unavailable. Use the host recovery CLI for a full recovery set.
It requires Python 3.9+ standard library and access to the data volume. The backup
contains sensitive records and account hashes: retain it in a private directory,
encrypt any off-host storage and limit access/retention according to owner policy.

```sh
python3 scripts/recovery.py backup --data-dir /opt/romani/data --output /root/romani-backup-UNIQUE
python3 scripts/recovery.py verify --backup /root/romani-backup-UNIQUE
python3 scripts/recovery.py restore --backup /root/romani-backup-UNIQUE --target /root/romani-isolated-restore-UNIQUE
```

The CLI takes a SQLite online snapshot and copies every attachment referenced by
that snapshot, including employee photos and staged uploads. It checks hashes,
database integrity and foreign keys. A missing/deleted attachment or corruption
fails the set; do not call an incomplete directory a backup. Files are immutable
under new unique paths, so concurrent deletion can make the backup fail safely.
For busy volumes, pause writes during the operation or retry a failed set into a
new directory. It never silently falls back to an older snapshot.

Restore refuses every existing target, including an empty production mount. It
copies into a new directory, preserves hashes and verifies again. Private Unix
directory/file modes are 0700/0600. To run the restored application as uid 1001,
grant that uid ownership **only on the isolated restore tree**, keep network
isolated and disable email/cron **only in the isolated copy** before starting.
Never start a restored production copy with outbound networking or SMTP credentials
merely to prove recovery. Environment secrets require a separate owner-managed
secure recovery source; they are deliberately absent from the backup.

The recovery CLI copies only the manifest-listed database and attachments. It
deliberately does **not** copy `.romani-volume`. Before testing the normal
production entrypoint against a restored tree, the operator must first verify
that the canonical host target is the newly approved isolated restore directory,
not `/opt/romani/data` or any production mount. Inspect the container's bind-mount
source and destination and verify that `/data` resolves to that isolated tree.
Only after those checks, create an empty `.romani-volume` **in that isolated host
tree**, owned by uid/gid 1001 with mode 0600, and verify it is a readable regular
file from the isolated container as uid 1001. Do not create it in the image layer,
on an unverified mount, or on production merely to bypass a startup failure. If
the target/mount cannot be established, stop the isolated boot and investigate;
never disable `server/index.ts`'s production volume guard. Keep outbound network,
SMTP and scheduling disabled during this isolated production-mode boot.

Evidence provenance: the recorded restored-app proof used `NODE_ENV=test`, a
fresh test-only JWT key and direct `createApp` construction from the compiled
modules, rather than the `server/index.ts` entrypoint. Its restored bind mount was
`/isolated`, the container ran as uid/gid 1001 with `--network none` and a read-only
image, and only the copied database's email/cron flags were disabled. It proved
preserved password authentication and attachment retrieval, not the production
volume-marker/bootstrap guard. No marker was created by that proof. The operator
step above is required for a future normal production-entrypoint restore check;
this documentation correction does not claim that check was executed.

Verify restored account hashes without printing them, then use the designated
credentials for login in the isolated instance. Download a restored attachment and
compare its SHA256. Preserve the source backup and production database. Promoting
a restored instance over production is a separate explicit rollout decision.

## Rollback and incident evidence

Before a release preserve and inspect the image that is actually running. Verify
its command and runtime files without starting the application or mounting data.
If application rollout fails, restore that preserved image through the deployment
controller and verify its health/build identity. Do not replace the database as
an application rollback, and do not change secrets to mask an application fault.
This release introduces no schema migration.

Capture sanitized status/error counts, exact head and merge SHA, image ID and
timestamps. Keep customer names, file contents, account emails and secrets out of
public receipts. Send concrete blockers/results directly to SA; tool acceptance is
not SA approval. Freeze only when the accepted B1–B8 ledger has journey and
operating evidence and the final release is accepted.
