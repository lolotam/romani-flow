# Evolution WhatsApp Reminders Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current approved lane. Use `superpowers:executing-plans` if available. Do not spawn agents, change models, purchase services, pair a number, send real messages or deploy merely because this plan exists.

**Goal:** Add QR-linked, fixed-template WhatsApp expiry reminders with named management recipients, employee opt-in, durable outgoing logs and cancellation on renewal, alongside existing email.

**Architecture:** Preserve the single API/SQLite deployment. Share due-item selection, isolate the existing email sender, and persist WhatsApp jobs/attempts before a single in-process worker contacts a fixed Evolution instance. Serialize eligibility-sensitive writes and final provider handoff; keep retry state independent of email's daily checkpoint.

**Tech Stack:** TypeScript, Express 5, Node fetch/node:sqlite/node:test, SQLite migrations, node-cron, React 18, current API client/shadcn components and Arabic/English translations. No Redis/BullMQ dependency is added to Romani.

**Specification:** `docs/superpowers/specs/2026-11-04-whatsapp-reminders-design.md`.

**Baseline:** `origin/main` fetched at `4c9fc35bfb86b9585aa0e83ede45891ad883619b`. Preserve dirty local `AGENTS.md`, untracked `supabase/`, Goal-B audit/fixtures, KEEP and rollback images. No cleanup.

## Task 0 — Resolve design defaults and provider prerequisites

**Files:** Specification above; future `.git/WHATSAPP_PROVIDER_PREFLIGHT.md` (sanitized, local-only).

- [ ] Owner reviews the three explicit defaults: use `mobile_no` without `phone` fallback; repeat overdue WhatsApp reminders daily until renewal; management-only company template plus existing residency-date coverage. Record adjustments in the specification before application code.
- [ ] Compare direct cron sends against durable in-process outbox; retain the outbox architecture unless the owner changes the fixed audit/retry requirements.
- [ ] Preserve the approved baseline; start an implementation branch from the accepted main, carrying only intentional changes. Do not stage `AGENTS.md`, `supabase/`, `.env` or `.git` audit artifacts.
- [ ] Recheck Evolution service identity/version/health using selected metadata only. Initial discovery found only Evolution Redis/Postgres services, not the API service. Do not equate dependencies running with API readiness.
- [ ] Identify the approved provider URL, instance name, ownership and installed-version contract. Secure-input tools are required for missing credentials; never request a password/key in chat. Do not read chats or list other projects' instance payloads.
- [ ] Pin the verified provider routes and sanitized response fixtures to the installed version. Upstream v2 instance routes are a reference, not installed-version evidence. If the service is unavailable, continue local adapter/outbox/UI work against the loopback fixture; real pairing/activation remains blocked only.

Provider interface used by the following tasks:

```ts
export type ConnectionState = 'unconfigured' | 'disconnected' | 'connecting' | 'connected' | 'unavailable';
export type SendOutcome =
  | { kind: 'provider_accepted'; messageId: string }
  | { kind: 'retryable_failed'; code: string; retryAfterSeconds?: number }
  | { kind: 'permanent_failed'; code: string }
  | { kind: 'unknown'; code: string };
export interface WhatsAppTransport {
  status(): Promise<{ state: ConnectionState; senderNumber?: string }>;
  connect(): Promise<{ state: ConnectionState; qrBase64?: string }>;
  sendText(phone: string, text: string): Promise<SendOutcome>;
}
```

## Task 1 — Schema, canonical recipients and repository invariants

**Create:**
- `server/db/migrations/007_whatsapp_notifications.sql`
- `server/notifications/whatsapp/contracts.ts`
- `server/notifications/whatsapp/phone.ts`
- `server/notifications/whatsapp/repository.ts`
- `scripts/verify-whatsapp-data.test.mjs`

**Modify:** `server/repositories/settings.ts`, `server/repositories/formDefaults.ts`, `src/lib/api/types.ts`, `src/types/index.ts`.

- [ ] Write failing SQLite tests using a temporary database and the real migrator. Establish existing employee rows, run the additive migration, and assert opt-in false plus no business-row loss. Assert recipient uniqueness after normalization and job uniqueness after duplicate enqueue.
- [ ] Add `whatsapp_notifications_enabled` and the recipient/job/attempt tables from spec section 8. Use `TEXT` timestamps, bounded state CHECK constraints and unique logical reminder identity. Store item/recipient snapshots rather than cascading audit deletion when a document/recipient disappears.
- [ ] Implement `normalizeWhatsAppPhone(input: string): string | null`. Strip only spaces/dashes/parentheses, translate an initial `00` to `+`, and require `/^\+[1-9]\d{7,14}$/`. Never guess `+965`, derive a number from an email, or accept JIDs/groups as UI destinations.
- [ ] Implement atomic insert/claim/update repository operations. Claim with an expected-state conditional update and verify the affected-row count before provider contact. Persist one attempt per handoff; uniqueness must not depend on a browser check.
- [ ] Add ordinary `whatsapp.enabled=false`. Keep URL/key/instance out of settings and backup business exports. Exclude the new employee opt-in and mobile from new-person defaults; retain per-record edit values.
- [ ] Run `node --import tsx --test scripts/verify-whatsapp-data.test.mjs`; expect all temporary-DB tests passing. Commit only these feature files after reviewing the staged diff.

Essential regression shape:

```js
assert.equal(normalizeWhatsAppPhone('00965 5555-0100'), '+96555550100');
assert.equal(normalizeWhatsAppPhone('55550100'), null);
assert.equal(normalizeWhatsAppPhone('group@g.us'), null);
// In a migrated temporary DB, inserting the same canonical management number
// twice must fail at the repository/database boundary, even with two requests.
```

## Task 2 — Fixed templates and due-item identity

**Create:** `server/notifications/whatsapp/templates.ts`, `server/notifications/whatsapp/selection.ts`, `scripts/verify-whatsapp-selection.test.mjs`.

**Modify:** `server/services/expiryService.ts` only to expose/reuse selection inputs without changing email formatting/deduplication; split common selection into `server/notifications/expirySelection.ts` if required to keep source files under 500 lines.

- [ ] Add literal string-equality tests for both owner templates and the reviewed company fallback. Dates must be `DD/MM/YYYY`; optional missing names produce a validation failure/skip, not another employee's name.
- [ ] Select document IDs with their employee/company relationships and current expiry directly from SQLite. Include existing residency-date items as the fixed label `الإقامة`; preserve existing selected thresholds and include-item settings. Do not add driving-license reminders.
- [ ] Build one delivery candidate per due item and canonical destination. Management receives all eligible configured items; employee candidates require that same employee's current opt-in, active state and valid current `mobile_no`.
- [ ] Collapse overlap at the canonical destination: a management recipient who is also the subject employee receives one management-template message for that item/occurrence.
- [ ] Keep pre-expiry `occurrence=''`; expired repetition uses the current scheduled UTC date. Include current expiry in every identity so a changed expiry creates a new cycle without erasing old evidence.
- [ ] Add boundary tests for 90/30/15/7/1, expiry day, overdue, no intervals, inactive employees, malformed mobile, same-number overlap, company-only documents and renewed dates. Run `node --import tsx --test scripts/verify-whatsapp-selection.test.mjs`; expect no network traffic.

Contract example:

```ts
export interface ReminderIdentity {
  instance: string;
  itemType: 'document' | 'employee_residency';
  itemId: string;
  expiryDate: string;
  bucket: number;
  occurrence: string;
  recipient: string;
}
```

## Task 3 — Fixed-host Evolution adapter and secure connection routes

**Create:** `server/notifications/whatsapp/evolutionClient.ts`, `server/routes/whatsapp.ts`, `scripts/verify-whatsapp-provider.test.mjs`, `scripts/verify-whatsapp-auth.test.mjs`.

**Modify:** `server/config.ts`, `server/app.ts`, `server/index.ts`, `.env.example`.

- [ ] Add optional server-only `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` configuration. Missing provider configuration leaves the existing application/email usable; global WhatsApp activation is rejected with an actionable code until complete. Never invent configuration values.
- [ ] Bind the adapter to the verified fixed host and approved instance. Reject user-supplied URLs/instance overrides; disallow redirects. Use encoded instance path segments, a 15-second timeout, capped response reads and no raw provider-body logging.
- [ ] Implement the verified installed-version QR/state/send contracts behind `WhatsAppTransport`. `connect()` must return existing connected state without logout/restart; an unknown instance produces a setup error rather than silently provisioning it.
- [ ] Classify documented non-acceptance versus ambiguous outcomes. A successful HTTP status without a valid provider message ID is not accepted. Do not retry network uncertainty automatically.
- [ ] Mount every WhatsApp route behind authentication and `requireAdmin`. QR responses use `Cache-Control: no-store`; no QR/key/session response is persisted or exposed to viewers. Return current envelope `{data,error}` with fixed codes and sanitized messages.
- [ ] Test through a loopback HTTP provider fixture that records requested paths/methods and headers in memory. Assert no contacts/chat/history calls and no incoming-message subscription writes. Tests must not print the fixture API key.
- [ ] Prove viewer requests cause zero provider calls and zero DB writes for status, connect, recipient mutation, retry and log endpoints. Prove unknown provider/401/429/timeout/malformed response behavior separately.
- [ ] Run `node --import tsx --test scripts/verify-whatsapp-provider.test.mjs scripts/verify-whatsapp-auth.test.mjs`; commit reviewed adapter/API changes.

Expected route surface is exactly spec section 11; no arbitrary free-text send or provider proxy endpoint.

## Task 4 — Durable outbox, retry and email-independent scheduling

**Create:** `server/notifications/whatsapp/dispatcher.ts`, `server/notifications/whatsapp/worker.ts`, `server/notifications/coordinator.ts`, `scripts/verify-whatsapp-dispatch.test.mjs`.

**Modify:** `server/services/cronService.ts`, `server/services/expiryService.ts`, `server/index.ts`, `server/app.ts`, `server/repositories/settings.ts`.

- [ ] Add a failing matrix: email disabled/failed/already-completed with WhatsApp enabled; WhatsApp disconnected/failed with email successful; both disabled; partial recipient failure. Confirm a global email completion flag currently cannot safely suppress the new channel.
- [ ] Preserve email's existing sender and checkpoint. At the existing scheduled firing, evaluate enabled WhatsApp selection with its own enqueue-day checkpoint. Do not migrate all channel settings or create a second user-configurable schedule.
- [ ] Commit candidate jobs atomically; drain through one in-process worker every 60 seconds. Add one in-flight worker guard and conditional DB claims; stop its timer on normal server shutdown. No provider contact when WhatsApp is off or configuration absent.
- [ ] Start a durable attempt before `sendText`. Known safe rejections may retry at +5/+15/+60 minutes, four attempts total, or a longer provider delay. Credentials/invalid-number/version errors fail permanently. Interrupted `sending` rows become `unknown` on startup; unknown never automatically replays.
- [ ] Cancel stale daily occurrences and no-longer-current threshold jobs before dispatch. A reconnect must not flush a backlog of yesterday's expired notices.
- [ ] Implement `NotificationCoordinator.runExclusive<T>(action: () => Promise<T>): Promise<T>` as the shared in-process gate. The dispatcher holds it from final eligibility read through the bounded provider handoff; mutations in Task 5 use the same instance. Do not hold a SQLite transaction while awaiting HTTP.
- [ ] Run real temporary-DB tests with deterministic clock injection and the loopback provider. Include competing drains, restart after claim, provider acceptance followed by lost response, timeout uncertainty, daily UTC rollover and destination-specific retry. Run an accelerated real node-cron firing separately from directly invoking a handler.

Core acceptance assertions:

```js
assert.equal(emailAcceptedCalls, 1); // A WhatsApp retry cannot resend email.
assert.equal(acceptedWhatsAppDestinationCalls, 1); // Retry failed destination only.
assert.equal(replayedUnknownCalls, 0);
assert.equal(replayedSupersededExpiryCalls, 0);
```

Commands: `node --import tsx --test scripts/verify-whatsapp-dispatch.test.mjs` then `npm run test:operations`. Do not broaden SMTP/send behavior outside this feature.

## Task 5 — Employee opt-in, renewal cancellation and write races

**Modify:** `server/services/documentService.ts`, `server/routes/documents.ts`, `server/routes/resources.ts`, `server/app.ts`, `server/routes/backup.ts`, `server/notifications/whatsapp/repository.ts`.

**Create:** `server/notifications/whatsapp/employeePolicy.ts`, `scripts/verify-whatsapp-renewal.test.mjs`.

- [ ] Add real API tests with an existing employee/expired document/queued job. Test expiry update, replacement plus expiry update, replacement without date change, failed upload claim, deletion, employee opt-out/mobile change and management-recipient disable/remove.
- [ ] Wrap relevant document mutations, employee mutations, recipient mutations, global WhatsApp disable and business erase in the shared coordinator. Add narrowly scoped asynchronous mutation hooks to `ResourceOptions` if needed; never leave the generic employee PATCH route as a bypass.
- [ ] Validate opt-in against the merged current employee row so unrelated PATCH requests preserve state and an invalid replacement mobile cannot coexist with enabled delivery. Treat booleans consistently with SQLite 0/1.
- [ ] On successful expiry-changing writes, cancel pending/retryable old-expiry jobs inside the same transaction as the row update. Keep accepted/unknown attempts and text snapshots as history. Failed writes must roll back cancellations too.
- [ ] Recheck global/employee/recipient enablement, item relationships and exact expiry inside the dispatch gate. On phone change cancel old-target jobs; new scheduling uses current canonical destination.
- [ ] Prove the race boundary using a deferred fake provider response: mutation waits for a previously started handoff; after mutation commit, no new old-expiry handoff begins. Never claim recall of an already sent WhatsApp message. Provider timeout must release the gate.
- [ ] Protect deletion/erase behavior for new tables: remove configuration only as appropriate to that existing action, preserve audit snapshots, cancel jobs before deleted items could dispatch, and avoid foreign-key failure. Do not execute erase in production.
- [ ] Run `node --import tsx --test scripts/verify-whatsapp-renewal.test.mjs`; commit when all mutation paths prove the invariant.

## Task 6 — Settings, outgoing log and employee UI

**Create:**
- `src/hooks/useWhatsAppSettings.ts`
- `src/components/settings/WhatsAppSettings.tsx`
- `src/components/settings/WhatsAppConnectionCard.tsx`
- `src/components/settings/WhatsAppRecipientsCard.tsx`
- `src/components/settings/WhatsAppLogCard.tsx`
- `src/lib/api/whatsapp.ts`

**Modify:** `src/pages/Settings.tsx`, `src/lib/api/index.ts`, `src/lib/api/endpoints.ts`, `src/pages/Employees.tsx`, `src/pages/EmployeeProfile.tsx`, `src/components/employees/EmployeeFormFields.tsx`, `src/components/employees/employeeTypes.ts`, `src/translations/ar/settings.ts`, `src/translations/en/settings.ts`, `src/translations/ar/employees.ts`, `src/translations/en/employees.ts`.

- [ ] Define API client methods matching spec section 11; keep transport/error handling consistent with `src/lib/api/http.ts`. Add bounded pagination and safe query encoding for logs.
- [ ] Add the WhatsApp Settings tab with disabled/unconfigured/connected states, sender status and QR action. QR data stays in component memory; remove it on dialog close/unmount and refresh only by explicit reconnect/rescan action. Do not place API credentials in any frontend field.
- [ ] Add named recipient CRUD with canonical duplicate errors and per-number switches. No arbitrary recipient can be sent a test message through an unreviewed UI action.
- [ ] Implement administrator outgoing log, fixed Arabic reminder text, attempt/state display and safe known-failure retry. Use “Accepted by provider” rather than “Delivered” for acceptance. Unknown rows explain uncertainty and have no resend button.
- [ ] Add employee opt-in to add/edit/profile flows; validate mobile only when opting in, and preserve a false default for new people. Verify round-trip API shapes and server validation, not UI-only enforcement.
- [ ] Follow existing Radix direction context/logical CSS and the RTL switch correction. Numbers remain readable LTR inside RTL layouts; labels, actions, error descriptions and loading/saving states translate consistently.
- [ ] Add translation/opt-in contract coverage to `scripts/verify-settings-translations.test.mjs` and `scripts/verify-form-defaults.test.mjs`; run `npm run test:forms`.
- [ ] Through supported T3 preview, perform a real built-frontend/compiled-backend synthetic journey: admin login, status, fake-provider QR, recipient add/edit/disable, employee opt-in/edit, real document renewal, and log readback. Prove Arabic RTL/English rendering and viewer denial. Do not substitute API-only saves for browser proof.

## Task 7 — Documentation, recovery and exact-head validation

**Modify:** `package.json`, `README.md`, `docs/OPERATIONS.md`, `docs/DOKPLOY.md`.

**Create:** `docs/WHATSAPP.md`, `scripts/verify-whatsapp-recovery.test.mjs`.

- [ ] Add `test:whatsapp` with explicit Node test files created in Tasks 1–5 and the recovery test. Keep all fixtures loopback-only, use synthetic numbers and no `.env`/production data.
- [ ] Document setup/secure variable entry, QR ownership, provider privacy boundary, statuses, uncertain outcomes, renewal behavior, operator enable/disable, separate reminder-vs-retry cadence and provider-service prerequisite.
- [ ] Prove the existing full SQLite+attachment backup captures new recipient/outbox/attempt state. Restore only into a new isolated directory, verify integrity/FK checks, and start with WhatsApp disabled/no provider credentials. Interrupted sends restore as unknown; a restore must never contact the real provider.
- [ ] Document that Evolution session/credentials/provider datastore are separate operational assets from the Romani SQLite backup. Do not falsely claim a Romani recovery set restores the linked WhatsApp session.
- [ ] Run checks once at the candidate head, one heavy job at a time:

```powershell
npm run typecheck
npm run build
npm run lint
npm run test:config
npm run test:forms
npm run test:operations
npm run test:whatsapp
npm run verify:api
```

Expected: all commands exit 0; capture actual counts/full SHA. Preserve prior test assertions. If API47 changes legitimately because the schema adds fields, explain the change instead of weakening assertions. Source files remain below the existing 500-line limit.

- [ ] Compare the staged diff against W1–W9 and verify no keys/QRs/real phone values or inherited local changes were staged. Self-review schema, authorization, concurrent writes, API privacy, unknown retry and per-channel checkpoints.

## Task 8 — Review and gated operational release

**Artifacts:** `.git/WHATSAPP_RELEASE_PACKET.md`, future `docs/WHATSAPP.md` receipts section.

- [ ] Open the feature PR only when implementation/checks are concrete; immediately link it using the full URL. Answer findings, resolve all thread pages and preserve exact-head review provenance. Do not start paid reviews or change model lanes without authority.
- [ ] Send the exact-head diff/checks/full-thread/rollback/schema compatibility packet to the existing SA session with `mode:auto`; record messageId/delivery. System receipt is not approval.
- [ ] Before proposing production migration, take a private verified pre-migration backup and rehearse additive migration/old-image readability on an isolated copy. Preserve Goal-B images and KEEP. Do not apply a production down-migration or replace the production DB to roll back this feature.
- [ ] Obtain the concrete release disposition, provider service/instance ownership and secure configuration readiness. Keep WhatsApp off until the designated sender scans the QR and explicitly designated recipient test numbers are ready.
- [ ] After approved match-head merge/deployment, verify actual new image/compiled modules/health/sanitized logs and unchanged reminder expression/timezone. Pair only the approved Romani instance; no shared instance reset or global provider reconfiguration.
- [ ] Controlled live proof uses one owner-designated administrator recipient and an authorized synthetic employee recipient/record, never inferred staff numbers. Record provider acceptance separately from actual recipient receipt. Prove old-date cancellation with the same authorized record; delete only that record if separately authorized. No mass catch-up or activation to every employee.
- [ ] Final W1–W9 receipt identifies feature/commit/image, real and isolated journeys, provider privacy limits, rollback and unresolved prerequisites. Freeze the new scope only after accepted evidence; do not stop the production service/scheduler merely to record a freeze.

## Coverage self-review

| Requirement | Tasks |
| --- | --- |
| W1 QR/auth/ownership | 0, 3, 6, 8 |
| W2 named recipients/RTL | 1, 3, 6 |
| W3 employee opt-in/mobile/defaults | 1, 2, 5, 6 |
| W4 templates/company/residency | 0, 2, 6 |
| W5 scheduling/channel independence/dedup | 2, 4 |
| W6 renewal/transaction/race | 4, 5 |
| W7 outgoing audit/privacy/uncertainty | 1, 3, 4, 6 |
| W8 restart/stale jobs/recovery/regressions | 4, 5, 7 |
| W9 review/release/live proof/rollback | 7, 8 |

Execution is inline by default. A blocked Evolution deployment does not block local implementation, but it does block honest claims of live QR/send readiness. This plan does not itself authorize secrets/environment changes, provider provisioning, real WhatsApp sends or production deployment.
