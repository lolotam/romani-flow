# P1 — Workspace isolation: implementation plan

Spec: `docs/superpowers/specs/2026-11-12-multi-user-workspaces.md` (approved 2026-11-12), section 5 and delivery step P1.
Branch: `feat/workspace-isolation`. Users see no change in P1: the existing login keeps working and every existing row belongs to one legacy workspace.

## Decisions taken in this plan

| # | Decision | Why |
| --- | --- | --- |
| D1 | `workspace_id` is added as a nullable column, backfilled to `ws_legacy`, then guarded by `BEFORE INSERT/UPDATE` triggers that abort on NULL. There is **no DEFAULT**. | A default would silently put a row written by a missed code path into the legacy workspace. Fail closed instead. SQLite cannot `ADD COLUMN … NOT NULL` without a default. |
| D2 | **Rollback is restoring the pre-migration backup**, not running the previous image on the new schema: the previous image's inserts would be rejected by the D1 triggers. | The owner must approve this before the production migration. |
| D3 | Tenant settings move to a new `workspace_settings(workspace_id, key, value, updated_at)` table. Platform keys stay in `settings`: `cron.schedule`, `system.*`, `document_drafts.*` locks, engine run status. | This avoids rebuilding `settings` and its erase triggers from migration 008. |
| D4 | Rebuild only `whatsapp_recipients`, to make the phone unique per workspace. The `form_defaults` and `document_drafts` key changes wait for P2, when one user can belong to several workspaces. | Otherwise "phone already used" would reveal another workspace's recipient. Draft and default keys are per user, and in P1 each user has exactly one workspace. |
| D5 | Existing upload files are **not moved**. New uploads go to `uploads/<workspace_id>/YYYY/MM/…`. Every file is served only after a workspace-scoped database lookup. | A SQL migration cannot move files atomically, and moving them is the hardest part to roll back. This deviates from spec §4 on purpose. |
| D6 | **Tenant seam:** `admin_users.workspace_id` (backfilled). `requireAuth` sets `req.tenant`, and `tenantOf(req)` throws when it is missing. In P2 only the source changes to Clerk's `orgId`. | The isolation suite can then log in to workspace A and workspace B with today's login. |
| D7 | Every helper in `repositories/base.ts` takes a required `Scope`. Relations, inserts, updates and deletes all filter by workspace, and foreign keys in a write must point to rows in the same workspace (404 otherwise). `workspace_id` is never client-filterable or client-writable. | The compiler becomes the inventory of call sites. |
| D8 | A guard test scans `server/**/*.ts` for raw SQL touching a tenant table without `workspace_id`. Allowed exceptions sit in a list, each with a reason. | Stops future regressions. |
| D9 | Background work runs **per workspace**: the expiry email automation, the daily completion guard (`workspace_settings`) and WhatsApp enqueue. The fixed WhatsApp instance belongs to `ws_legacy` only. | Per-workspace WhatsApp instances are P4. |
| D10 | Catalog seeding runs per workspace when a workspace is created. `ws_legacy` keeps its current rows. A new workspace gets only the generic catalog, with generated ids: the four ministries (Interior, Justice, Health, Public Works) and the seven positions from `ownerCatalogs.ts`. It never gets Romani's companies or document types. Backup export and erase act on the caller's workspace only. The workspace JSON export cannot restore an erased workspace, because only export and erase exist. | Owner decision 2026-11-12 (option A). The companies and document types in the owner catalog and seed are Romani's own data. |
| D11 | `cron.schedule` is one **platform** setting: one timer, and each firing reports every active workspace whose `cron.enabled` is on, one at a time, with failures isolated per workspace. Only the **platform admin** (the owner's account, from the admin dashboard in P3) changes the schedule and the notification policy (D12); workspace users never do. Until the admin dashboard exists, the `ws_legacy` login (today the owner's login) keeps that control and every other workspace gets 403 `schedule_platform_managed`; resending the unchanged value is a no-op. WhatsApp routes exist only for the workspace that owns the instance (404 `whatsapp_unavailable` otherwise) until per-workspace instances in P4, and the scheduled WhatsApp selection runs only while that workspace's own `cron.enabled` is on. A manual report covers the caller's workspace only. | Owner decision 2026-11-12: the admin controls schedules and notifications for everyone. |
| D12 | **Notification policy (built with the admin dashboard in P3).** The admin enables or hides offsets from a fixed list: 90, 60, 30, 15, 7 and 1 days before expiry. Each document card, and each employee card for residency expiry, chooses which of the *enabled* offsets apply to it; hidden offsets are neither shown nor sent. A record with no choice of its own, including every existing record, uses all enabled offsets. The same offsets drive email and WhatsApp. The per-workspace `email.notification_intervals` setting is retired then. | Owner decisions 2026-11-12: the user picks from what the admin allows; default is all enabled; one policy for both channels and for residency. |

## Tenant tables

`companies, ministries, document_types, positions, employees, documents, email_log, expiry_notifications, pending_uploads, form_defaults, document_drafts, whatsapp_recipients, whatsapp_jobs, whatsapp_attempts, upload_cleanup_queue (nullable, internal), admin_users (membership, P1 only)`, plus the new `workspace_settings`.
Platform tables: `workspaces, settings, schema_migrations`.

## Slices (each one green before the next starts)

**A. Schema and seam.** Users see no change.
1. Write `010_workspaces.sql`: the `workspaces` table, the `ws_legacy` row (name "Romani", `legacy_claim_email` NULL until the owner provides it), the columns, the backfill, the NULL-guard triggers, `workspace_id`-leading indexes, `workspace_settings` with the tenant keys moved out of `settings`, and the `whatsapp_recipients` rebuild.
2. Migration test: it builds a database at 009 with synthetic rows in every tenant table, applies 010, and checks that every row is in `ws_legacy`, that a NULL insert is refused, that the 006/008 triggers still fire, and that integrity and foreign-key checks pass.
3. Seam: `req.tenant` and `tenantOf(req)`. Extend the `reminderApi` fixture with workspaces A and B, each with an admin.

**B. Scoping and proof.**
1. Write `scripts/verify-tenant-isolation.test.mjs` and the route inventory first, and watch them fail.
2. `base.ts`: add `Scope` to every helper. Fix all call sites the compiler reports, then the raw SQL in services and repositories, then add the D8 guard.
3. Settings repository: read tenant keys from `workspace_settings`.
4. Pulled forward from C: expiry service, cron and WhatsApp enqueue per workspace (D9, D11), and scoped backup export and erase (D10). Proved by `verify-tenant-isolation`, `verify-tenant-routes` and `verify-tenant-writes` (`npm run test:workspace`); the last two fail when a new read or write handler is added without a decision on how workspace B is kept out.

**C. Files, jobs and backup.**
1. Per-workspace upload prefix (D5): `StorageService.save` takes the workspace id and writes to `<workspace_id>/YYYY/MM/`; the id must match `[A-Za-z0-9_-]{1,64}`. File routes look the record up through scope first. Proved by `verify-workspace-setup`.
2. Per-workspace catalog seeding with generated ids (D10: generic ministries and positions only), and default settings for a new workspace. `createWorkspace` writes both in one transaction (`db/starterCatalog.ts`, `ensureWorkspaceDefaults`). Proved by `verify-workspace-setup`.

## Gates

- On every slice: `typecheck`, `lint` (500-line file limit; `extraction/service.ts` and `routes/documentExtraction.ts` are at the limit, so they must be split if touched), and every `test:*` suite plus the new suites.
- Before production: owner approval, a `scripts/recovery.py backup` snapshot taken with owner approval (the WAL is bigger than the database file, so a plain copy is stale), a rehearsal of 010 on that snapshot in an isolated container, then deploy.
- PR #25 also touches `server/routes/files.ts`. Rebase after it merges.

## Known limits after slice B

- The cron run lock is process-wide: while one workspace's report runs, a manual run in another workspace answers `already_running`.
- The backup export's `settings` now holds only the caller's `workspace_settings` rows; platform settings are no longer exported. No restore consumes the file today.


## P2a — Clerk server seam (behind `AUTH_PROVIDER`)

- `AUTH_PROVIDER` is `legacy` by default, and legacy behaviour is unchanged. `clerk` requires `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` at boot. `PLATFORM_ADMIN_EMAILS` is the platform admin allowlist (verified email only).
- `requireWorkspace` (server/auth/middleware.ts) takes the place of `requireAuth`. The tenant comes from the Clerk organization's link in `workspaces.clerk_org_id`, never from the request. An unlinked organization first tries the legacy claim: a verified email equal to `legacy_claim_email` and `org:owner`, at most once. Otherwise it gets a new workspace with defaults and the generic catalog. While the legacy workspace is unlinked and no claim address is stored (`LEGACY_CLAIM_EMAIL` unset), no organization is claimed or provisioned: every unlinked organization gets 503 `legacy_claim_pending`, so the address must be set before the Clerk switch. Webhooks never provision or claim; they only rename, suspend and sync users, so an early `organization.created` cannot strand the legacy data.
- Roles: viewer reads only, editor writes tenant data, owner also gets settings, backup, WhatsApp, email and AI extraction. Legacy `admin` counts as owner.
- Migration 011 adds `users` and `clerk_webhook_events`, and rebuilds `form_defaults`, `document_drafts` and `pending_uploads` without the `admin_users` foreign keys. Drafts and form defaults are keyed by `(workspace_id, user_id, …)`, which completes the D4 key change, since one Clerk user can belong to several workspaces.
- Proved by `scripts/verify-clerk-auth.test.mjs` (in `test:workspace`). Only Clerk is faked, and webhook payloads are signed with the real verifier.
- Not yet done: the SPA sign-in (P2b) and removal of the old login (P2c, needs owner approval and the claim email O1).

## P2b — Clerk in the SPA

- One build serves both modes: the SPA reads the public `GET /api/auth/config` (`provider`, and `publishableKey` in clerk mode only) before rendering. `npm run build:client` fails if a server-only Clerk value appears in `dist/` (`scripts/verify-client-bundle.mjs`).
- Clerk mode: `@clerk/react` sign-in at `/login/*` and sign-up at `/sign-up/*`, Arabic/English localization, `OrganizationSwitcher` and `UserButton`. A 403 `workspace_required` shows `OrganizationList`. `/api/auth/me` uses the selected auth middleware; legacy `/api/auth/login` answers 410 `legacy_login_disabled` in clerk mode.
- Switching organization clears the query cache and re-reads the session; drafts and last-submission state are keyed by workspace and user.
- UI roles come from `src/lib/permissions.ts` (`canEdit`, `isOwner`); viewers do not see write controls. The server remains the enforcement.
