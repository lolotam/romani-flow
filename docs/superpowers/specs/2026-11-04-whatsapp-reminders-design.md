# Evolution WhatsApp reminders — feature specification

Status: the owner confirmed the three reminder choices on 2026-11-04: use the current employee mobile with country code; send once in the expired bucket; include company documents and employee residency. SA accepted this revised design for local reminder implementation; production migration, enablement and the first live send remain separately gated. QR/status is already deployed as described in `docs/WHATSAPP_PAIRING.md`; real pairing, webhook activation and reminder release remain separate gates. This document describes requirements and evidence, not execution authority.

## 1. Outcome and baseline

Add WhatsApp expiry reminders alongside the existing email automation. Romani scans a QR code displayed in Romani Flow Settings and becomes the sender. Named management recipients receive document reminders; an employee receives only their own reminders when an administrator enables that employee's notification switch.

The accepted Goal-B release remains `4c9fc35bfb86b9585aa0e83ede45891ad883619b`, image `sha256:438582f0ee35ed218fc1e6c7279ad60788a1b100979d14cae5ffebc015d22d0a`. This is a new feature scope, not a reopening of Goal B. Preserve its rollback, KEEP, audit, fixture and data assets.

The separate QR/status and login releases are now deployed at `6b48727b383f7123d150affd2b82c16b7acfa783`, following login merge `68e1ca3b66ef33849f13f4bd2f2359fab9b72e10`. This is the reminder implementation source baseline; Goal-B receipts remain historically attributed. The separate local reminder implementation adds migration007 and the worker described in `docs/WHATSAPP.md`; none is claimed deployed to production.

Observed code baseline:

- `server/services/expiryService.ts` selects eligible documents and employee residency dates; current email deduplication includes item, expiry date, threshold and recipient.
- `server/services/intervals.ts` defines 90/30/15/7/1-day thresholds and an expired bucket. Existing email sends once per bucket, including the expired bucket.
- `server/services/cronService.ts` runs the automation and currently has an email-oriented daily completion guard.
- Employee forms use `mobile_no`; legacy records can also contain `phone`. There is no WhatsApp employee opt-in or reminder-delivery integration yet; QR/status is implemented separately.
- Documents have an internal UUID and title, but no separate business document-number column. The owner's final templates use name and expiry, not an invented document number.

## 2. Confirmed owner requirements

1. Keep email and add WhatsApp as a selectable notification channel.
2. Use Evolution API on the existing server; connect Romani's sender number through a QR scan in the platform.
3. Configure multiple management numbers with names and individual enabled switches.
4. Add an employee-level notification switch in the add/edit employee form.
5. Send fixed reminder text; vary the employee name, document name and expiry date.
6. Use the existing reminder timing, including expired documents; do not add an immediate document-created message.
7. A permitted administrator can renew a document by uploading its replacement and changing its expiry. Old-expiry reminders must stop and the new expiry starts a new reminder cycle.
8. Show the platform's outgoing reminders and attempts in an audit log, without a personal WhatsApp inbox or conversation-history screen.

## 3. Owner-confirmed choices and safe implementation defaults

The owner explicitly selected the current mobile field with country code, a single expired reminder, and both company-document and residency coverage. These choices supersede the earlier daily-overdue proposal. The remaining disabled-by-default and privacy constraints below are implementation safeguards, not permission to activate production sends:

| Decision | Required behavior |
| --- | --- |
| Employee destination | Reuse `employees.mobile_no`; no separate WhatsApp number field. Never silently fall back to `phone`. Require an explicit country code when enabling delivery and reject a canonical number already used by another opted-in employee. Legacy opted-in collisions fail closed for employee delivery; separately explicit management routing is preserved. |
| Reminder unit | One fixed message per document per eligible destination, replacing the earlier management-summary suggestion. |
| Expired repetition | Send once when the item enters the expired bucket, per item/expiry/bucket/canonical recipient, not daily. Repeated scheduler runs, restarts and reconnects cannot resend a provider-accepted or unknown identity. Pre-expiry thresholds remain once per expiry/threshold/recipient. A successfully changed expiry starts a new eligible identity; old-expiry pending jobs are cancelled. Existing email semantics remain unchanged. |
| Company-only documents | Notify enabled management recipients using the company template below; never send to an employee. |
| Existing employee residency reminders | Preserve eligibility and represent them as the fixed document label `الإقامة`; use the same opt-in and renewal rules against `residency_expiry_date`. Do not invent additional driving-license automation. |
| Initial activation | WhatsApp disabled globally; every existing/new employee opt-in false. Management numbers are added explicitly, never inferred from email addresses or account details. |
| Language | Approved fixed Arabic WhatsApp copy; Settings/forms/log labels support Arabic RTL and English. Email language remains independent. |

## 4. Exact templates

Management — employee document:

> تذكير: وثيقة «{اسم الوثيقة}» الخاصة بالموظف «{اسم الموظف}»، تاريخ انتهائها {تاريخ الانتهاء}. يُرجى متابعة التجديد.

Employee:

> أهلاً بيك «{اسم الموظف}»،
> تذكير: وثيقة «{اسم الوثيقة}» تاريخ انتهائها {تاريخ الانتهاء}. يُرجى متابعة التجديد مع الإدارة.

Management-only company template for the owner-confirmed company-document coverage:

> تذكير: وثيقة «{اسم الوثيقة}» الخاصة بالشركة «{اسم الشركة}»، تاريخ انتهائها {تاريخ الانتهاء}. يُرجى متابعة التجديد.

Render dates as `DD/MM/YYYY`. Use stored names as plain text, not executable markup. No attachment, civil ID, password, private chat content or unrequested metadata is included. A message is still a reminder when its printed expiry is in the past; no misleading “expires soon” sentence is added.

## 5. Settings and employee experience

Keep the existing email controls. Add a WhatsApp Settings tab with:

- Global enable switch and a clear disabled/unconfigured/disconnected/connected state.
- Existing sanitized connection state, available to administrators only. Do not add account-profile discovery or invent a sender display number; the fixed instance and account-holder confirmation establish the sender.
- “Connect / Show QR” action; display the transient QR with a rescan action when it expires. Reopening Settings must not reconnect or log out an already connected account.
- Named management recipients: add, edit, enable/disable and remove. Normalize international numbers; reject duplicates after normalization. Accept `+` or `00` country prefix, remove spaces/dashes, store canonical `+` plus 8–15 digits, reject national-only, malformed, group and broadcast destinations. Do not guess a country.
- Shared reminder-threshold controls explicitly linked to the existing thresholds and scheduler. No second user-defined schedule.
- Outgoing reminder log with time, recipient label/number, audience, item/title/expiry snapshot, fixed text, attempt count, outcome and sanitized failure reason. Paginate and filter by outcome/destination/item.
- A retry action only for an unambiguously failed, still-current reminder. An uncertain outcome has no automatic/manual resend action in v1.

Add `whatsapp_notifications_enabled` to the employee add/edit form. When enabled, validate the current `mobile_no`; when disabled, preserve ordinary employee saving even if the legacy phone is unsuitable for WhatsApp. Explain that the employee receives only their own reminders. Do not copy this opt-in or a previous person's mobile number into a new employee through saved form defaults. Editing an existing employee preserves that employee's stored choice.

QR payloads are transient sensitive connection material: administrator-only, `Cache-Control: no-store`, no general logs, exports, localStorage or database persistence. Scanning is performed by the owner, not the agent.

## 6. Integration and privacy boundary

The browser calls authenticated Romani backend routes only. The backend calls a fixed, operator-approved Evolution URL and fixed Romani-dedicated instance. The UI cannot supply arbitrary hosts, instance names or outbound URLs. Environment-only server configuration: `ROMANI_EVOLUTION_URL`, `ROMANI_EVOLUTION_API_KEY`, `ROMANI_EVOLUTION_INSTANCE`, `ROMANI_EVOLUTION_WEBHOOK_SECRET`; no secret in ordinary settings, exports, frontend bundles or chat. Future value entry is performed by Waleed through `request_secret` or the hub UI. The manager must not read or copy the provider private handoff file; do not rerun earlier file-based configuration helpers.

Never select an arbitrary first instance, reuse another project's connected sender, restart/logout/delete another instance, or overwrite shared provider/webhook configuration. A dedicated instance can use the shared API service once its ownership and version are verified.

Do not call chat-history, contacts, incoming-message or conversation-list endpoints. Do not subscribe Romani to incoming-message/history events or forward personal message bodies into its application. Logs cover only attempts initiated by this feature. Provider acceptance is not handset delivery or reading: v1 shows `provider_accepted`, never “delivered/read” without independently authenticated provider evidence. Delivery/read webhooks are outside v1.

This application boundary does not make a QR-linked Evolution session technically unable to access account data. Verify provider-level storage/history configuration for the dedicated instance and disclose any residual provider storage before pairing. Do not promise an impossible account-level send-only permission. Never change global Evolution retention/event flags on a shared service without a separate reviewed operator change.

Primary references consulted: [Evolution instance routes](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/routes/instance.router.ts) and [Evolution webhook events](https://github.com/evolution-foundation/evolution-docs/blob/main/docs/02-Configuration/Webhooks.md). Upstream main is not proof of the installed API version. Pin adapter contracts to the verified installed version before enabling real provider calls.

Initial 2026-11-04 name/image discovery matched Evolution Redis/Postgres but did not establish API absence. A later exact managed-service receipt and narrow exact-ID read confirmed healthy `curemedkw-evultionapi-wrtdxe`, custom2.3.7/sourcef1100ad/imagebe2cbdef..., with dedicated allocation `romani` separate from `curemed`. See `docs/WHATSAPP_PAIRING.md` for identity/contract. Native isolation, provisioning, private credentials and real QR readiness remain separate gates. Shared infrastructure is coordinated by the Curemed manager, not duplicated by Romani.

## 7. Architecture choice

Recommended: shared due-item selection, unchanged email delivery behavior, and a SQLite-backed WhatsApp outbox drained by one in-process worker. This preserves retries/audit across restarts without adding a second deployed service.

Alternative: synchronous WhatsApp sends directly inside the cron handler. Less code, but weaker restart recovery and more coupling between slow provider calls and email. Rejected for this feature because truthful attempts, per-recipient retry and renewal cancellation are explicit requirements.

Do not add a separate WhatsApp schedule, external broker, marketing composer, inbox or bulk campaign subsystem.

## 8. Durable state and independence

Use an additive migration after `006_form_defaults.sql`:

- `employees.whatsapp_notifications_enabled INTEGER NOT NULL DEFAULT 0 CHECK (... IN (0,1))`.
- `whatsapp_recipients`: ID, label, canonical phone, enabled, timestamps; unique canonical phone.
- `whatsapp_jobs`: identity, item type/ID, expiry snapshot, threshold, recipient snapshot, audience/template, state, attempt count, next attempt time, provider ID and timestamps. Persist the intended text privately for audit. Unique logical reminder identity.
- `whatsapp_attempts`: durable per-attempt records, start/end, state, sanitized code, provider ID. Do not overwrite historical attempts.
- Ordinary setting `whatsapp.enabled=false`; integration secrets remain outside SQLite.

Logical identity: `(instance, item_type, item_id, expiry_date, bucket, canonical_recipient)`. There is no calendar-date occurrence column or daily expired identity. The expired bucket is `0`, matching the existing selector, and is eligible once for the same expiry and recipient. Channel independence follows separate WhatsApp state: an email success never suppresses WhatsApp, and a WhatsApp failure never resends successful email. The same canonical number configured as both management and the document's employee gets one management-template reminder for that item/expiry/bucket.

Draft outbox clarification (not implemented by the QR-only slice): enforce identity uniqueness for non-cancelled jobs only. A retained cancelled row is immutable audit history and does not prevent a fresh job for a currently eligible identity. Concurrent re-enqueue creates exactly one live job. An existing `provider_accepted` or `unknown` identity still suppresses another handoff. This covers an unsent expiry A→B→A and recipient removal/re-addition without erasing history or duplicating an accepted/uncertain identity.

When a canonical destination gains or loses management status, recompute the winning audience in the same transaction as the recipient mutation. Reclassify a still-unsent eligible pending/retryable job to the winning template without changing its identity or attempt count; do not cancel a still-valid employee destination merely because its management row was removed. Cancel only if neither audience remains eligible. Accepted/unknown attempts are not reclassified or resent. Test employee→management and management→employee transitions explicitly when implementing the reminder outbox.

Owner decision (2026-11-04): a phone edit to an existing employee or management
recipient replaces already-prepared unsent work for the same still-eligible
source item on the same day using its current eligible expiry/bucket, including
combined phone/expiry edits and crossed buckets, atomically with cancellation. Never derive a
replacement from accepted/unknown work. Pending/retryable and explicitly safe
permanent failures qualify; new destinations remain subject to capacity and
accepted/unknown identity suppression. This exception does not enqueue on a new
audience/document, global enable or expiry-only change.

The existing global `cron.last_run_date` cannot serve as a shared delivery-success flag. Keep email's current completion tracking; give WhatsApp enqueue a separate day checkpoint. The checkpoint controls selection work only; changing the day must not change logical job identity or resend accepted/unknown expired reminders. Evaluate both channels even if email is disabled, lacks recipients, fails or was already processed. A single worker checks due jobs every 60 seconds; this is transport retry processing, not a change to reminder cadence. Both channels disabled means no delivery. No unbounded queues or catch-up bursts. Admitted jobs and the enqueue checkpoint commit in the same outer SQLite transaction; the checkpoint advances only after admitted inserts succeed, with uniqueness making reruns idempotent.

## 9. Renewal, eligibility and race handling

Before every dispatch, load current item, expiry, employee, global enablement, employee opt-in and management-recipient state. Cancel the job if deleted, renewed, disabled, no longer due or addressed to an old phone. Re-render from current names when still valid. A replaced file without a changed expiry does not reset deduplication. A failed renewal transaction leaves the old date and its eligibility unchanged.

For a still-valid job whose names/audience changed, atomically save the new rendered text and item/recipient/audience snapshots with the new immutable attempt before marking it `sending`. Dispatch exactly that stored attempt text; log/history displays the attempt snapshot, never a later re-rendered job. Earlier attempts remain unchanged. A name-change regression must prove transmitted bytes equal the recorded attempt text.

Update expiry and cancel unsent old-expiry jobs in the same database transaction. Apply equivalent cancellation to document deletion and employee residency-date changes. A phone or recipient-setting change cancels obsolete queued destinations. Serialize the final eligibility check/provider handoff with relevant document/employee/recipient mutations using one process-level notification gate; do not hold a SQLite transaction open across HTTP. The current deployment must remain a single application replica. A future multi-replica deployment requires a cross-process design review.

An already-handed-off message cannot be recalled. Guarantee: once a successful renewal/disable mutation commits, no new old-snapshot handoff begins. A provider request initiated before that commit can finish afterward and remains truthfully logged. The mutation may wait for the bounded in-flight handoff to finish; apply a 15-second HTTP timeout and show normal saving feedback.

On reconnect, cancel jobs for a superseded expiry, obsolete threshold or no-longer-eligible destination. A still-current, never-handed-off expired job remains eligible across day boundaries as the same single job; do not cancel it merely because the calendar day changed or enqueue a daily replacement. Drain a bounded batch without a catch-up burst. Previously accepted/unknown expired identities remain suppressed.

## 10. Failures and retry policy

States: `pending`, `sending`, `provider_accepted`, `retryable_failed`, `permanent_failed`, `unknown`, `cancelled`.

Insert the attempt and mark `sending` before network I/O. Accept success only with HTTP 201, a bounded self-sent key.id and exact matching key.remoteJid; a missing destination is unknown/no resend. This owner-approved Romani acceptance policy is stricter than the pinned native minimal success contract. Automatic retries are limited to proven pre-HTTP `ENOTFOUND`, `EAI_AGAIN` and `ECONNREFUSED` failures, after 5, 15 and 60 minutes, bounded to four attempts total and still-current eligibility. No generic HTTP rejection or provider retry-delay hint establishes a safe retry. Timeout/reset, unclassified HTTP and malformed success remain unknown. Pinned pre-handler authorization and local zero-fetch validation failures are permanent; show an actionable administrator error without raw provider bodies.

Permanent failures do not retry automatically. After correction and current-eligibility reconciliation, an administrator may explicitly retry only the pinned pre-handler `provider_unauthorized` or local zero-fetch `invalid_text` and `whatsapp_not_configured` codes, still within four attempts and queue capacity. Unknown, accepted, cancelled and unclassified remote failures remain ineligible for manual resend. The log shows translated allowlisted reasons and generic copy for an unrecognized code, never raw provider text.

Network timeout/reset after handoff, malformed ambiguous success, or process restart while `sending` becomes `unknown`: do not blindly resend. Evolution acceptance can precede a lost response. Exactly-once external delivery is not promised; v1 favors visible uncertainty over automatic duplicates. Never manufacture success or handset delivery. Disconnected instances defer pending jobs without consuming send attempts; revalidate current eligibility on reconnect without inventing daily identities.

## 11. API boundary

Every browser/operator `/api/whatsapp/*` route requires an active authenticated administrator. The existing connection-only `/api/whatsapp/webhook` instead uses its dedicated constant-time header authentication plus exact project/event filtering; it never authenticates with a cookie or body API key. Viewer denial occurs before QR generation, provider contact, retries or writes.

| Route | Contract |
| --- | --- |
| `GET /api/whatsapp/status` | Sanitized `configured` and connection `state` only; no sender profile, API key or raw session. Global `whatsapp.enabled` is read from `/api/settings`. |
| `POST /api/whatsapp/connect` | Obtain a fresh QR for the fixed approved instance only; do not disconnect an existing connected account. No implicit provisioning of unknown instances. |
| `GET /api/whatsapp/recipients` | Paginated named recipient rows. |
| `POST /api/whatsapp/recipients` | Validate name/phone/enabled; normalize and enforce uniqueness. |
| `PATCH /api/whatsapp/recipients/:id` | Validated atomic change plus stale-job cancellation. |
| `DELETE /api/whatsapp/recipients/:id` | Remove that recipient configuration; cancel its unsent jobs, retain audit snapshots. |
| `GET /api/whatsapp/log` | Paginated reminder attempts with safe filters, administrator only. |
| `POST /api/whatsapp/jobs/:id/retry` | Retry a known failure only after current eligibility checks; reject unknown/accepted/cancelled jobs. No arbitrary number or free-text send route. |

Global WhatsApp enable is written through the existing validated administrator settings route. Disabling takes effect before another handoff. No user-facing arbitrary provider URL/key input.

Shared logging prerequisite: the Curemed manager owns the approved LOG_LEVEL patch/reload. SA accepted the Q8 execution verification receipt, SHA256 `262fd084465a61b891ab219f7178cf5caf9d332dcbbbeed3d3c381d7434dd813`; this satisfies the logging execution gate and is operator evidence, not a Romani server rerun. Holder QR has been separately authorized; its scan/open receipt remains pending. Keep webhooks off until that receipt, then perform connection-only webhook activation and scoped smoke as separate gated steps. The native query-override isolation gate remains open before any live send. Local reminder work uses loopback fixtures only; no live messaging is authorized here.

## 12. Acceptance and rollout

Before live sending, require verified HTTPS or an explicitly owner-approved dedicated-network
isolation disposition with runtime proof. Operator approval of a plain HTTP URL alone is insufficient.
The private encrypted overlay maintenance receipt is separate from application release approval;
native query-override isolation and the remaining release gates must still be satisfied.

| ID | Required proof |
| --- | --- |
| W1 | Administrator can connect the fixed instance by QR; viewer cannot request QR/status/log/mutations or trigger provider traffic. |
| W2 | Multiple named canonical recipients persist, duplicates rejected; Arabic RTL/English labels and switches work. |
| W3 | Employee opt-in defaults false, validates mobile when enabled, persists on edit and never carries across new employees; no colleague data reaches an employee. |
| W4 | Exact fixed texts render per item; company documents reach management only, and residency uses the employee's opt-in/current mobile plus enabled management recipients. |
| W5 | Existing scheduled pre-expiry/expired selection works; both channels independent; accepted/unknown expired identities do not repeat across days/restarts/reconnects, and confirmed failures retry alone. |
| W6 | Successful renewal cancels unsent old-expiry jobs, new date creates a new cycle; replacement-only and failed renewal do not reset; race/in-flight boundary proven. Unsent A→B→A and recipient remove/re-add enqueue exactly one current job; accepted/unknown identities still block duplicates. Audience transitions and name changes preserve the intended recipient and exact audit/dispatch text. |
| W7 | Durable logs distinguish provider acceptance, failure and uncertainty; no personal incoming chats, QR, key or raw provider data leak into API/export/logs. |
| W8 | Restart/disconnect/stale threshold/duplicate worker claims and once-only expired delivery are tested; existing email, forms, backup and isolated restore regressions pass. |
| W9 | Exact-head build/typecheck/lint/tests, review threads and approved release packet; preserve old image and private pre-migration backup. Controlled QR/live reminder proof uses explicitly designated sender and recipients, never guessed employee/customer numbers. |

Implement and test locally with a loopback fake Evolution HTTP server and synthetic employees before real pairing. Fake provider tests prove application contracts, not real WhatsApp delivery. Real scan/send, production environment changes, instance provisioning and deployment remain gated by the reviewed rollout packet and explicit scope; this documentation request performs none of them.

The release introduces an additive schema migration: rehearse on an isolated copy and verify backward readability before proposing image-only rollback. Preserve the database and new audit data; no down-migration, wiping or production restore to undo activation. Keep WhatsApp disabled until sender, recipients, policy and service prerequisites are satisfied. Do not change the observed unset `TZ` / resolved UTC / `0 8 * * *` cadence.


Owner erase disposition (2026-11-04): business erasure retains WhatsApp audit
snapshots/attempts and management recipient configuration, disables WhatsApp
sending and clears the enqueue-day checkpoint atomically with business deletion.
New records cannot resume sending until deliberate re-enable. The UI explicitly
discloses retained names/numbers/message text. This is not a personal-data purge.

Phone correction cancels the old destination identity and uses the approved safe-unsent replacement or scheduled selection. A locally invalid-number failure is not a same-identity manual retry; accepted/unknown work remains suppressed.
