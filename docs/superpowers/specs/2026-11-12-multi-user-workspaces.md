# Multi-user workspaces with Clerk — feature specification

Status: approved by the owner on 2026-11-12. Production Clerk instance uses live keys (`pk_live_`). Owner choices were collected on 2026-11-12 (recorded in §2). This document is a design, not execution authority. Every production step (Clerk keys, migration, deploy, WhatsApp provisioning) needs its own owner approval.

## 1. Outcome

Romani Flow becomes a multi-user platform. Anyone can sign up with email + password or Google, through Clerk. Each user works inside a private **workspace**: their own companies, employees, documents, lists, settings, email reminders and WhatsApp sender. A workspace can have team members with roles. No user can read, list, download or infer another workspace's data. That includes the platform admin, who sees only aggregate counts.

Today the app is single-tenant: one shared dataset, `admin_users` with email/password sessions (`server/middleware/auth.ts`), global `settings`, and one fixed Evolution WhatsApp instance (`docs/WHATSAPP_PAIRING.md`). The database is SQLite (`node:sqlite`). SQLite has no row-level security, so isolation is enforced in the application layer (§5) and proven by tests (§9).

## 2. Owner decisions (2026-11-12)

| Topic | Decision |
| --- | --- |
| Auth provider | **Clerk** (`@clerk/express` on the server, Clerk React SDK in the SPA). |
| Sign-up | Open sign-up. |
| Login methods | Email + password and Sign in with Google; the same verified email maps to the same Clerk user. |
| Spam protection | Email verification, sign-up/login rate limits (Clerk bot protection + app limits), per-workspace quotas. |
| Lists | Fully separate per workspace: companies, ministries, document types, positions. |
| Privacy | Fully private. Nobody outside a workspace can see its documents, including the platform admin. |
| Platform admin | The owner's Google account (configured via `PLATFORM_ADMIN_EMAILS`, not hard-coded) keeps admin access to an **admin dashboard**: counts per workspace (users, workspaces, documents), plus control of the platform report schedule and the notification policy (section 7). It never sees workspace content. |
| Teams | A workspace can have members with roles **Owner / Editor / Viewer**. |
| Quotas (defaults, adjustable per workspace) | 1 GB storage, 2,000 documents, 500 WhatsApp reminders per month, 5 members. |
| WhatsApp | Per-workspace sender: each workspace owner scans their own QR. The app may hold the Evolution master key server-side to provision instances. |
| Existing production data | **Kept**. It moves into a workspace owned by a normal user **Romani** (not an admin). |
| Owner's own account | Keeps login as a normal user with a new empty workspace, plus platform-admin dashboard access. |

## 3. Concepts

- **User**: a Clerk user. The app stores only `clerk_user_id`, primary verified email, display name and timestamps. Passwords, Google tokens and verification are Clerk's job.
- **Workspace**: the isolation boundary. 1:1 with a **Clerk Organization**. A user with no organization must create or join one. There is no automatic personal workspace. The UI uses `hidePersonal` on Clerk's organization components, so a personal account is not offered.
- **Role** (Clerk custom organization roles): `org:owner`, `org:editor`, `org:viewer`.
- **Platform admin**: not a workspace role. It is a server-side allowlist of verified emails (`PLATFORM_ADMIN_EMAILS`), checked against the Clerk user's verified primary email. It grants only `/api/platform/*`.

## 4. Data model (migration `010_workspaces.sql`)

New tables:

```
workspaces(id TEXT PK, clerk_org_id TEXT UNIQUE NULL, name TEXT, owner_user_id TEXT,
           quota_storage_bytes INTEGER, quota_documents INTEGER,
           quota_whatsapp_monthly INTEGER, quota_members INTEGER,
           storage_used_bytes INTEGER NOT NULL DEFAULT 0,
           legacy_claim_email TEXT NULL, created_at, updated_at)
users(id TEXT PK, clerk_user_id TEXT UNIQUE, email TEXT, name TEXT, created_at, last_seen_at)
workspace_usage(workspace_id, month TEXT, whatsapp_sent INTEGER, PRIMARY KEY(workspace_id, month))
```

`workspace_id TEXT NOT NULL REFERENCES workspaces(id)` is added to every tenant table: `companies`, `ministries`, `document_types`, `positions`, `employees`, `documents`, `settings` (key becomes `(workspace_id, key)`), `email_log`, `expiry_notifications_v2`, `pending_uploads`, `form_defaults`, `whatsapp_recipients`, `whatsapp_jobs`, `whatsapp_attempts`, `document_drafts`, `upload_cleanup_queue`. Every table is re-audited during implementation, and any table not listed must be classified as tenant or platform with a reason.

- Catalog names have no uniqueness constraint, so workspaces can reuse names. Companies, ministries, document types and positions are not unique on name, inside a workspace or across workspaces.
- Every tenant index leads with `workspace_id`.
- Platform-level settings (SMTP transport, Evolution URL, cron schedule) move to a `platform_settings` table, or stay in env. They are never readable from workspace APIs.
- New uploads are stored at `uploads/<workspace_id>/YYYY/MM/<uuid>-<name>`. Migration 010 does not move existing upload files; their `YYYY/MM` paths stay valid. Only new uploads go under the workspace folder.

**Backfill of existing data.** The migration creates one workspace `ws_romani_legacy`, with `legacy_claim_email` set to Romani's login email (open item O1). It assigns every existing tenant row to it. It does not move existing upload files; their `YYYY/MM` paths stay valid, and only new uploads go under the workspace folder. The first time a Clerk user with that **verified** email signs in, the server links the workspace to that user's Clerk organization as `org:owner`, and clears `legacy_claim_email`. A non-verified email can never claim it. `admin_users` is retired: the table is kept read-only for rollback and is no longer used for login.

## 5. Isolation enforcement (replacing RLS)

1. **Tenant context middleware.** After `clerkMiddleware()`, a `requireWorkspace` middleware resolves `getAuth(req)`: `userId`, `orgId`, `orgRole`. It maps `orgId` to a local workspace and sets `req.tenant = { workspaceId, userId, role }`. A missing or unknown org returns 401/403. The client can never send a `workspace_id`; it always comes from the verified Clerk session.
2. **Scoped data layer.** All tenant reads and writes go through a `TenantDb` created per request from `req.tenant`. The generic helpers (`listRows`, `findRow`, `insertRow`, `updateRow`, deletes) require a workspace id and always add `WHERE workspace_id = ?`. On insert they set it, ignoring any client value. Routes no longer get the raw `db` handle for tenant tables. A lint/test guard fails the build if a route imports the raw connection for a tenant table.
3. **Cross-table references are checked.** When a document references `employee_id` or `company_id`, or a WhatsApp job references a document, the referenced row must belong to the same workspace. Otherwise the server answers 404, so a foreign ID cannot be attached.
4. **Not found, not forbidden.** Accessing another workspace's ID returns 404, identical to a non-existent ID. Existence is never revealed.
5. **Files.** Downloads and previews look the document up through `TenantDb` first and only then stream the file. Paths are never accepted from the client.
6. **Background jobs.** The reminder cron and the WhatsApp worker iterate workspaces and process each one with its own `TenantDb`. A job row carries `workspace_id`, and its sender is that workspace's WhatsApp instance and that workspace's recipients only.
7. **Roles.** Viewer: read and download only. Editor: create, edit and delete documents, employees and lists. Owner: plus settings, members, WhatsApp, reminder recipients, deleting the workspace. Each role is checked server-side with `auth.has({ role })` on every mutating route, and the UI only hides buttons.
8. **Backup, restore and erase** become per workspace, owner only, and can never touch another workspace. A full-database restore stays a platform operator procedure (`docs/OPERATIONS.md`), not an API.
9. **AI extraction** settings become per workspace and stay disabled by default. No document is sent to an external AI without that workspace owner's explicit opt-in.

## 6. Authentication with Clerk

- The SPA wraps the app in the Clerk provider and uses Clerk's sign-in/sign-up components (email + password, Google, email verification) plus the organization switcher and member management.
- The server uses `clerkMiddleware()` for all `/api` routes. The current `romani_session` cookie login, `/api/auth/login` and password handling are removed once Clerk is live.
- A Clerk webhook (`/api/webhooks/clerk`, verified with `verifyWebhook`, raw body) syncs `user.created/updated/deleted` and `organization.*`/`organizationMembership.*` into `users`/`workspaces`. It is idempotent by event id.
- A user with no organization must create or join one before the app loads a workspace. The app does not create a personal workspace, and the organization UI uses `hidePersonal`.
- **Privacy note:** Clerk (a US service) stores user names, emails and login metadata. Documents, employees and files never go to Clerk.
- Secrets: `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` are server-only env. `VITE_CLERK_PUBLISHABLE_KEY` is the only client value. They're collected through the secure secret prompt and never in chat.

## 7. Platform admin dashboard

`/admin` is visible only to `PLATFORM_ADMIN_EMAILS`, enforced server-side via `/api/platform/*`. It shows:

- Totals: users, workspaces, documents, storage used, WhatsApp reminders this month.
- Per workspace: workspace name, owner email, member count, document count, storage used, WhatsApp sent this month, created date, last activity, quota status.
- Actions: adjust a workspace's quotas, suspend/unsuspend a workspace.
- Platform controls (owner decision 2026-11-12): the daily report schedule, and the notification policy. The admin enables or hides expiry offsets from a fixed list (90, 60, 30, 15, 7, 1 days). Each document and employee card picks which enabled offsets apply to it; a record without a choice uses all enabled offsets. The same offsets drive email and WhatsApp. Workspace users cannot change the schedule or the offset list.

It **cannot** list document titles, employees, files, recipients or a workspace's own settings, and there is no "log in as user". The endpoints run fixed aggregate queries (`COUNT`, `SUM`) grouped by workspace and return no row content. A test asserts that no document/employee field ever appears in a platform response.

## 8. Quotas and abuse limits

- These are checked inside the same transaction as the write: document create checks the document count, upload checks `storage_used_bytes + size`, member invite checks the member count, and the WhatsApp send checks `workspace_usage`.
- Exceeding a quota gives a clear 409 `quota_exceeded`, with the limit shown in the UI.
- App-level rate limits for upload and other write endpoints are applied per user and per IP. Sign-up and login rate limits come from Clerk.

## 9. Per-workspace WhatsApp

- The workspace owner opens Settings → WhatsApp → Connect. The server provisions an Evolution instance named `rf-<workspace_id>` using the master key, which stays server-only and is never returned to clients. It stores that instance's scoped token encrypted (AES-GCM with an app key from env) on the workspace.
- QR and status endpoints become workspace-scoped and owner-only. Each workspace sees only its own instance state.
- Reminders for a workspace send only from its own instance, and only to its own management recipients and opted-in employees (existing rules in `2026-11-04-whatsapp-reminders-design.md` apply per workspace).
- Disconnecting or deleting a workspace logs the instance out and deletes it.
- The Romani legacy workspace keeps the existing paired instance, mapped to it during migration, so Romani does not need to re-scan.

## 10. Privacy proof (acceptance tests)

A dedicated suite `scripts/verify-tenant-isolation.test.mjs` creates workspaces A and B with users of every role. As B it calls **every** `/api` route with A's real IDs: list, get, update, delete, file download/preview, drafts, extraction, email send, WhatsApp, backup/export. It asserts 404, or an empty list, and that no A data appears in any B response or side effect. It also checks:

- List endpoints never return another workspace's rows, even with filters or search terms that match them.
- A cron run sends A's reminders only to A's recipients from A's instance.
- Platform admin responses contain counts only.
- A route-inventory test fails if a new `/api` route is added without being listed in the isolation suite.

This suite runs in CI on every PR from then on.

## 11. Delivery plan (separate PRs, each gated)

1. **P1 Workspace data layer.** Migration 010, `TenantDb`, all routes and jobs scoped, files per workspace, isolation suite. The old login stays, mapped to the legacy workspace, so production behavior is unchanged. A migration rehearsal runs on a copy of the production DB.
2. **P2 Clerk auth.** Clerk sign-up/sign-in, Google, verification, organizations and roles, the webhook, creating or joining an organization (no automatic personal workspace; the UI uses `hidePersonal`), the Romani legacy claim, the owner's personal workspace, and retirement of the old login.
3. **P3 Admin dashboard and quotas.**
4. **P4 Per-workspace WhatsApp.**

Each PR includes tests and the isolation suite. Production deploys need owner approval and a backup (`scripts/recovery.py backup`) before any migration.

## 12. Open items for the owner

- **O1** Romani's login email (Google or email/password) that will claim the existing data.
- **O2** Create the Clerk application. Enable Email + Password, Google, email verification, Organizations ("membership required"), and custom roles `org:owner`, `org:editor`, `org:viewer`. Add the production domain and webhook URL. Then provide the keys through the secure prompt.
- **O3** Confirm the Clerk plan covers Organizations and the expected user count (check current Clerk pricing).
- **O4** Approve storing the Evolution master key and an encryption key as server-only env for P4.
