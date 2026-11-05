# WhatsApp document reminders

This feature adds an independent WhatsApp reminder channel to the existing email
automation. The owner confirmed the current employee mobile with country code,
one expired reminder per expiry/recipient, company documents for management, and
employee residency. The shared-service QR/status integration is described in
[WHATSAPP_PAIRING.md](WHATSAPP_PAIRING.md); text sending is pinned in
[WHATSAPP_SEND_CONTRACT.md](WHATSAPP_SEND_CONTRACT.md).

## Release and activation boundaries

Migration `007` is additive: an employee opt-in column, named recipients, durable
jobs and attempts. The global switch and every employee opt-in default false.
No recipients are inferred from accounts/email/legacy phone fields. Existing
email settings and completion history remain independent.

The server migrates during startup. Therefore merging this feature while main
auto-deploys would also apply `007` to production. Exact-head reviews and an explicit
production migration/release disposition are required before merge. Local tests,
source approval or an accepted earlier QR release are not that disposition.

Before rollout, rehearse the additive migration and old-image compatibility on
an isolated recovery copy, preserve the verified pre-migration backup and the
actual running rollback image, and attach the result to the release packet.
Never down-migrate or replace a production database to roll back this feature.

Future environment values are entered by Waleed through `request_secret` or the
hub UI. The manager must not read/copy the provider private handoff file or rerun
file-based helpers. Backend names only: `ROMANI_EVOLUTION_URL`,
`ROMANI_EVOLUTION_INSTANCE`, `ROMANI_EVOLUTION_API_KEY`,
`ROMANI_EVOLUTION_WEBHOOK_SECRET`. Never use a master/Curemed key or `VITE_` copy.

The shared Q8 logging execution receipt was accepted separately (SHA256
`262fd084465a61b891ab219f7178cf5caf9d332dcbbbeed3d3c381d7434dd813`);
this is Curemed operator evidence, not a Romani server rerun. The native
post-auth query-override concern in [WHATSAPP_SEND_CONTRACT.md](WHATSAPP_SEND_CONTRACT.md)
remains a separate pre-live-send isolation gate. The adapter uses the exact
server-derived `/message/sendText/romani` URL with no query string.

Plain HTTP does not encrypt the scoped key or reminder content. Production transport
requires a separately accepted HTTPS or dedicated-network isolation disposition before
live sending; local compatibility with HTTP is not that proof. This feature does not
change the shared service, network or environment to satisfy that gate.

Keep live sends off until that isolation gate, production release/migration,
approved holder pairing and scoped smoke are explicitly dispositioned. QR, webhook
activation and first live reminder are separate recorded steps. No customer or
staff recipient may be guessed; controlled live reminder recipients and records
must be explicitly designated. Local fixtures prove application behavior only.

## Administrator workflow

1. In Settings → WhatsApp, verify the dedicated connection state. Connecting the
   account does not enable reminder delivery.
2. Add management recipients by name and international number. `+` and `00`
   prefixes are accepted; separators normalize to canonical `+` plus digits.
   National-only numbers, provider JIDs/groups and canonical duplicates fail.
   Each recipient has its own enabled switch; new rows default disabled.
3. In an employee's add/edit form, explicitly enable that employee's reminders.
   The current `mobile_no` must have a country code. There is no `phone` fallback,
   separate WhatsApp destination or carry-over of mobile/opt-in to a new person.
   An employee receives only their own documents/residency; company-only items
   go to management. At a shared canonical destination, management copy wins.
4. Enable global WhatsApp delivery only after connection and the release gates.
   This does not change the existing email switch.
5. Read the outgoing log, filter by outcome/international destination/document,
   and inspect immutable attempt text and recipient snapshots. Only safe known
   failures offer retry. Proven authorization/local text or configuration
   failures require correction and an explicit retry; they never retry
   automatically. The four-attempt limit and current eligibility still apply.
   Unknown, accepted and
   cancelled rows cannot be forced to resend.
   Number correction uses a new destination identity; it never retries the old address.

These controls and logs are administrator-only. The backend verifies the current
database role before provider contact or mutation; client role headers grant no
authority. The connection-only webhook keeps its separate constant-time header
authentication and exact project/event filter; it does not use a session cookie
or native body API key. There is no arbitrary free-text/test-send endpoint.

## Cadence, renewal and delivery semantics

The existing configured cron expression/timezone and selected 90/30/15/7/1-day
thresholds remain the source of selection. Expired items use bucket 0 exactly once
for `(instance,item_type,item_id,expiry_date,bucket,canonical_recipient)`, with no
day/occurrence identity. A daily checkpoint bounds selection work; it is not
permission to repeat yesterday's accepted/uncertain expired reminder.

WhatsApp selection runs independently even when email is disabled, failed or
already completed. No immediate document-created send is introduced. A single
in-process worker drains at most 10 eligible jobs per 60-second tick, with a 2000-job
pending/sending/retry backlog cap. Selection commits the eligible jobs that fit,
logs only the deferred count and leaves overflow for the next scheduled selection
after backlog drains. Overflow is not persisted as an old-bucket job: the next
selection re-evaluates current eligibility and bucket. An original threshold can
be missed; eventual delivery of that original threshold is not guaranteed.
Existing accepted/unknown identities still suppress duplicates;
the cap cannot permanently stall an oversized first batch. Audit history is retained separately
from pending capacity.

A current unsent expired job survives a disconnected day as the same job. On
reconnect, revalidate the current item/expiry/destination before handoff; never
create a daily replacement or replay accepted/unknown identities. Jobs for an
obsolete threshold, changed expiry, deleted item, old phone or disabled audience
are cancelled. Returning an unsent date A→B→A or removing/re-adding an unsent
destination may enqueue one fresh current job at the next selection; retained
cancelled history does not block it. Accepted/unknown identities still suppress
duplicates.

Owner-approved phone-change exception: when an existing employee or management
recipient number changes, replace already-prepared, still-eligible unsent work
for the same source item on the same day, using its current eligible expiry/bucket.
This includes a combined phone/expiry edit and a prepared job that crossed a bucket
boundary. Cancellation and replacement
commit with the phone edit. Accepted/unknown work cannot authorize a replacement;
an existing accepted/unknown identity at the new destination still suppresses it.
Only pending/retryable or proven-safe permanent failures qualify, including exhausted
DNS/refused failures proven to occur before HTTP handoff. Exhaustion still forbids
retrying that old identity. New audiences,
new documents, global enable and expiry-only changes do not trigger immediate enqueue.
Capacity overflow remains subject to the next scheduled selection described above.

Renewal commits expiry change and unsent-job cancellation in the same SQLite
transaction. A failed transaction changes neither. Replacing only the attachment
does not reset identity. A shared single-process gate serializes relevant writes
with the final eligibility check and bounded provider handoff; no SQLite
transaction is held across HTTP. Once a mutation commits, no new old-snapshot
handoff begins. A message handed off before that commit cannot be recalled.
Changing to multiple application replicas requires a coordination review.

The attempt and exact text are durable before the send. 201 with a valid self-sent
message ID means `provider_accepted`, not delivered/read. A native 400 may occur
after send and is uncertain. Lost response, timeout, malformed/oversized success
or restart while sending becomes `unknown`; no automatic/manual resend. Proven
pre-HTTP DNS failure (`ENOTFOUND`/`EAI_AGAIN`) or `ECONNREFUSED` can retry at
5/15/60 minutes, at most 4 attempts and only
while still eligible. Status disconnected/unknown defers without consuming an
attempt. No incoming conversations, attachments or personal IDs are sent by this
feature. Provider session storage/logging remains a separate operational boundary.

## Backup and isolated recovery

The existing full SQLite-plus-referenced-attachments recovery set includes the
recipient, outbox and immutable attempt tables. Administrator JSON export also
includes those tables, but is not the full attachment recovery set. Integration
secrets and the Evolution session/datastore are separate assets, never business
export fields. A Romani backup does not restore the WhatsApp linked-device session.

Use [OPERATIONS.md](OPERATIONS.md) for verified source/output separation, private
permissions and backup/restore commands. Restore into a new approved isolated tree
only; never replace production to prove restore. Verify manifest/integrity and
attachment bytes before changing the restored copy. Keep provider credentials
absent and explicitly set `whatsapp.enabled=false` in the verified isolated
database before any restored application/worker startup. Interrupted attempts
become unknown; accepted identities remain suppressed. Marker preparation for a
normal production entrypoint is a separate verified isolated-mount procedure.

Local recovery coverage proves real SQLite/attachment restoration, persisted
recipient/attempt text and zero provider calls with the restored worker disabled.
It does not claim a normal production-bootstrap or real WhatsApp-session restore.

## Local verification

`npm run test:whatsapp` uses real SQLite/API middleware and a loopback fake
Evolution with synthetic destinations. It covers migration/defaults, selection,
canonical collisions, day/restart/reconnect dedup, unknown outcomes, renewal
rollback/races, audience transitions, immutable text, real local timer firing,
viewer denial, HTTP adapter bounds and isolated restore. `test:forms`,
`test:config`, `test:operations`, `test:whatsapp-pairing` and isolated `verify:api`
remain required regressions. Preserve original assertions and exact-head receipts.

## Reminder readiness and shutdown

The settings screen applies successful recipient, audit and global-state reads
independently. If the global setting itself is unavailable or malformed, it displays
an unavailable state and disables the switch rather than presenting an editable OFF.
Restart recovery is scoped to the runtime's own jobs and linked attempts; an invalid
runtime neither starts the worker nor rewrites any outbox namespace. Audit access
remains read-only and separate from admission readiness.

Employee opt-in writes reject a canonical mobile already used by another opted-in
employee, including inactive opted-in records. Validation and the business write
share the same transaction/coordinator. Legacy collisions bypassing that path
fail closed for employee delivery during selection/reconciliation; existing safe
unsent employee jobs are cancelled. Explicit management recipients retain their
separately authorized management routing and precedence. No legacy record is
silently rewritten or opted out.

Saving an already-enabled WhatsApp value does not require provider connectivity;
unrelated settings can be saved while disconnected. Only a stored false-to-true
transition checks send readiness and connection, inside the shared coordinator
before atomic settings commit. Pending delivery still waits for connection.

Acceptance requires HTTP 201 with bounded self-sent key.id and exact matching
key.remoteJid. A missing destination is unknown/no resend. This conservative
Romani policy is stronger than the pinned native minimal success contract.

Reminder enablement and send use the same configuration predicate: exact instance
`romani` and a canonical HTTP/HTTPS origin-only `ROMANI_EVOLUTION_URL` (optional
trailing slash, no base prefix, query, fragment or credentials). Pairing's broader
fixture namespace/prefix compatibility does not make a configuration send-ready.
For example, an explicit default port or uppercase URL spelling that differs from
the normalized origin is refused for reminders before provider access.

On shutdown the worker, cron and async API handlers stop new admission immediately while HTTP drains
in parallel. Handler work is tracked separately from sockets: a disconnected client does not
discard an in-flight SMTP result. The database closes only after the worker, cron, HTTP and
handler drains finish. The application hard
deadline is 90 seconds, allowing the SMTP phase timers and worker drain; interrupted sends
remain durable for unknown recovery. Before deployment verify that the managed
container stop grace allows this deadline with operational margin. Current host
grace is not established by local tests; this remains a release prerequisite.


Business erase retains WhatsApp recipient configuration and all job/attempt audit
snapshots, including names, numbers and exact text. It disables WhatsApp and clears
the enqueue-day checkpoint inside the same transaction as business deletion;
safe unsent jobs are cancelled, accepted/unknown history remains. The AR/EN
confirmation discloses this retention. New business records do not resume
WhatsApp until an administrator deliberately re-enables it. No personal-data
purge or automatic recipient deletion is implied.

Production runtime construction derives outbox authority from the same strict
local origin/exact-romani predicate as sending. An invalid local configuration
owns no outbox namespace: it cannot admit jobs/replacements or advance the day
checkpoint even if the database was enabled before restart. No live provider
connection is required for selection under valid local configuration. Previously
stored unsupported-instance jobs are not silently deleted; any such data needs
separate operator review.

Shutdown also closes cron admission and awaits every active scheduled/manual run,
including an overlapping selection, before database close. SMTP phase/idle timers
are 15/15/30 seconds; these are not a whole-operation bound. The application hard
ceiling is 90 seconds, not a delivery guarantee. A forced process/host termination
can still leave an email outcome uncertain; no exactly-once email claim is added.
Verify actual managed stop grace exceeds this ceiling with margin before release;
no production grace change or proof is implied by local lifecycle tests.

Phone correction cancels the old destination identity and uses the approved safe-unsent replacement or scheduled selection. A locally invalid-number failure is not a same-identity manual retry; accepted/unknown work remains suppressed.

Final handoff selection reads the claimed item and destination rather than rebuilding
all document/residency candidates. Employee delivery still checks a minimal projection
of opted-in mobile numbers to detect legacy canonical collisions; management-only
claims do not require that projection. Daily selection and full mutation refresh remain.
Business erase cancels unsent jobs in the fixed audit namespace inside its transaction,
even when sending configuration is invalid; accepted/unknown and other namespaces survive.

## Message language and template preview

Settings selects WhatsApp and Email languages independently (Arabic or English). WhatsApp uses the validated `whatsapp.language` key, defaulting to Arabic; Email keeps `email.language`. No schema migration is required. The channel language is independent of the administrator's UI language. Document/person names stay as stored, and the English residency label is localized.

Each channel shows a fixed synthetic text preview from the same server renderer used for delivery. The admin-only, no-store `GET /api/whatsapp/template-preview?channel=whatsapp|email&language=ar|en` endpoint reads no customer records and sends nothing. These are fixed templates, not a free-form message editor. Email remains the existing grouped management report.

Changing language reconciles eligible pending snapshots under the notification coordinator. Accepted/unknown outcomes and prior attempt text remain unchanged; language is not a new deduplication identity and cannot cause a resend. Selecting a language never enables sending or changes the schedule.
