# ROMANI Flow — Implementation Plan

**Branch:** `feature/sqlite-backend`
**Spec:** [`docs/SPEC.md`](./SPEC.md)
**Status:** draft → under Codex review

---

## Execution rules

1. **Phase order is strict.** Each phase ends with a green build (`npm run build`) and a green lint (`npm run lint`). A phase that does not build is not done.
2. **≤ 500 lines per file.** Enforced by `scripts/check-file-sizes.mjs`, run as part of `npm run lint`.
3. **No new file** is created above 500 lines; target is ≤ 300 for new code.
4. **Server and client share `src/types`.** No duplicated entity interfaces.
5. **Every phase is one commit.** Small, reviewable, revertible.
6. **The Supabase removal is not optional** — it is Phase 0, because everything else depends on a working auth + data layer.

## Phase map

| Phase | Goal | Depends on |
|---|---|---|
| 0 | Foundations: tooling, config, SQLite connection, migrations | — |
| 1 | Repositories + REST API + auth (server) | 0 |
| 2 | Client swap: `src/lib/api/*`, `useAuth`, page migration | 1 |
| 3 | File bucket: storage service + upload/download/preview endpoints | 1 |
| 4 | SMTP + templates + expiry report + cron | 1 |
| 5 | Email documents (single + bulk) | 3, 4 |
| 6 | Settings UI (email / cron / SMTP) + translations | 2, 4, 5 |
| 7 | Large-file refactor (the 500-line cleanup) | 2 |
| 8 | Docker/Dokploy: image, compose, volume mount, docs | 3, 4 |
| 9 | Seed 2 admins, end-to-end verification, cleanup | all |

---

## Phase 0 — Foundations

**Goal:** a running SQLite-backed server skeleton with migrations applied and the old Supabase code removed.

### T0.1 Tooling and scripts
- [ ] Add server deps: `express`, `cookie-parser`, `multer`, `bcryptjs`, `jsonwebtoken`, `node-cron`, `zod` (already present: `nodemailer`).
- [ ] Add dev deps: `tsx` (server dev runner), `@types/express`, `@types/multer`, `@types/jsonwebtoken`, `@types/cookie-parser`, `@types/bcryptjs`, `@types/node` (present).
- [ ] `package.json` scripts: `server`, `server:dev`, `db:migrate`, `db:seed`, `db:reset`, `check:sizes`.
- [ ] `scripts/check-file-sizes.mjs` — fails if any file under `src/` or `server/` exceeds 500 lines. Wired into `lint`.

### T0.2 Configuration
- [ ] `server/config.ts` — typed env parsing with defaults, plus `validate()` that throws in production when `JWT_SECRET` is missing.
- [ ] `server/config.ts` must expose: `PORT`, `DATA_DIR`, `UPLOADS_DIR`, `DB_PATH`, `JWT_SECRET`, `SMTP_*`, `MAX_UPLOAD_MB`, `MAX_EMAIL_ATTACHMENT_MB`, `ADMIN_SEED_*`, `NODE_ENV`.

### T0.3 Database connection
- [ ] `server/db/connection.ts` — open `node:sqlite` `DatabaseSync`; PRAGMAs: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- [ ] Ensure `DATA_DIR` exists and is writable at boot; fail loudly otherwise.

### T0.4 Migrations
- [ ] `server/db/migrator.ts` — reads `server/db/migrations/*.sql` in filename order, skips versions already in `schema_migrations`, applies each in a transaction.
- [ ] `server/db/migrations/001_init.sql` — the 9 tables from SPEC §4.1 + `schema_migrations`.
- [ ] `server/db/migrations/002_indexes.sql` — the indexes from SPEC §4.2.
- [ ] `server/db/migrations/003_email_log.sql` — `email_log` + `settings` if not in 001 (keep one source of truth: put both in 001, use 003 only if needed).

### T0.5 Remove Supabase
- [ ] Delete `src/integrations/supabase/` (client + types).
- [ ] Delete `supabase/` (dead migrations + dead edge function).
- [ ] Delete `scripts/export-data.html`, `scripts/export-supabase-data.js` (contain a committed key).
- [ ] Remove the Supabase key from `data/supabase-export.json` if present (it is not) and from any other file.
- [ ] Keep `data/supabase-export.json` as the **seed source** (rename to `data/seed.json` for clarity, update references).

### T0.6 Server bootstrap
- [ ] `server/index.ts` — load config → open DB → migrate → seed → mount app → start cron → listen. Graceful shutdown (close DB, stop cron).
- [ ] `server/app.ts` — express app: `helmet`-style security headers (manual, to avoid a dep), `cookie-parser`, JSON body limit, `/api` routes, static `dist/` with SPA fallback, `/files` route.

**Exit criteria:** `npm run db:migrate` on an empty volume creates the schema; `npm run server` starts and `/api/health` returns `{ ok: true, db: 'ok' }`; no Supabase reference remains in the tree.

---

## Phase 1 — Server data layer & auth

### T1.1 Generic repository
- [ ] `server/repositories/base.ts` — CRUD over SQLite with: filter parsing (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `in`), `order`, `limit`, `offset`, and safe `select` projection.
- [ ] Table/column identifiers validated against an allow-list derived from the schema — never interpolated from user input without validation.
- [ ] Join support for `table(*)` tokens (the old "relationship simulation"): `employees` → `companies`, `documents` → `employees` / `companies` / `document_types` / `ministries`.
- [ ] Timestamps: `created_at` / `updated_at` set by the server, never by the client.

### T1.2 Specific repositories
- [ ] `server/repositories/employees.ts` — includes residency-expiry query used by the expiry service.
- [ ] `server/repositories/documents.ts` — includes expiry-window query and status recomputation.
- [ ] `server/repositories/catalog.ts` — companies, ministries, document_types, positions.
- [ ] `server/repositories/adminUsers.ts` — find by email, update last_login.
- [ ] `server/repositories/settings.ts` — key/value get + bulk upsert, JSON-encoded values, typed accessors for the known keys.

### T1.3 Auth
- [ ] `server/middleware/auth.ts` — read the `romani_session` cookie, verify the JWT, attach `req.user`; `requireAuth` / `requireAdmin` guards.
- [ ] `server/middleware/validate.ts` — zod schemas for request bodies.
- [ ] `server/middleware/errorHandler.ts` — uniform `{ data: null, error: { message, code } }` envelope; never leak stack traces in production.
- [ ] `server/routes/auth.ts` — `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- [ ] Login rate limiting per IP (simple in-memory token bucket — no extra dependency).

### T1.4 Resource routes
- [ ] `server/routes/catalog.ts` — companies, ministries, document-types, positions (list/create/read/update/delete).
- [ ] `server/routes/employees.ts` — list/create/read/update/delete.
- [ ] `server/routes/documents.ts` — list/create/read/update/delete.
- [ ] `server/routes/settings.ts` — `GET /api/settings`, `PUT /api/settings` (non-secret keys only; reject attempts to write `smtp.*` secrets).
- [ ] `server/routes/health.ts` — `GET /api/health`.

**Exit criteria:** curl a full CRUD lifecycle against every resource; `POST /api/auth/login` with a seeded admin returns a session cookie and `/api/auth/me` resolves it.

---

## Phase 2 — Client swap

### T2.1 The API client
- [ ] `src/lib/api/http.ts` — `fetch` wrapper: JSON in/out, cookie credentials, timeout, error envelope normalisation, 401 → sign-out event.
- [ ] `src/lib/api/queryBuilder.ts` — fluent chain → query string. Same method names as the old `QueryBuilder`: `select`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, `order`, `limit`, `offset`, `execute`.
- [ ] `src/lib/api/client.ts` — `from()`, `insert()`, `update()`, `delete()` with the identical return shape `{ data, error }`.
- [ ] `src/lib/api/endpoints.ts` — typed calls for the new features (files, email, cron, settings).

### T2.2 Auth
- [ ] `src/hooks/useAuth.tsx` — rewrite: `login(email, password)`, `logout()`, `isAuthenticated`, `user`, `isLoading`; session from the cookie via `/api/auth/me` on mount.
- [ ] `src/pages/Login.tsx` — username field becomes **email**; Arabic + English validation; error surfacing.
- [ ] `src/components/ProtectedRoute.tsx` — unchanged contract.

### T2.3 Page migration
- [ ] Swap `jsonDatabase` → `api` import in every page/component. **One file at a time, build after each.**
- [ ] Order: `Employees.tsx` → `Documents.tsx` → `EmployeeDocuments.tsx` → `CompanyDocuments.tsx` → `EmployeeProfile.tsx` → `Dashboard.tsx` → `Settings.tsx` → `DocumentForm.tsx` → `CompanyEmployees.tsx`.
- [ ] Delete `src/lib/jsonDatabase.ts` and `public/data/database.json` (client-side copy) once nothing imports them.

### T2.4 Duplicate-key fixes
- [ ] Fix the duplicate `status` and `entityNamePlaceholder` keys in `src/translations/en.ts` and `ar.ts`.

**Exit criteria:** the app builds; logging in shows real SQLite data; creating an employee in the browser is visible after a server restart.

---

## Phase 3 — File bucket

### T3.1 Storage service
- [ ] `server/services/storageService.ts` — `save(buffer, originalName, mimeType)`, `read(relativePath)`, `delete(relativePath)`, `exists()`, `stat()`.
- [ ] Path layout `yyyy/mm/<uuid>-<sanitised-name>`; `file_path` stored relative to `UPLOADS_DIR`.
- [ ] Traversal guard: resolve the final absolute path and assert it starts with the resolved `UPLOADS_DIR`.
- [ ] Sanitiser: strip directory separators, control characters, and cap the length.

### T3.2 Upload / download / preview
- [ ] `server/routes/files.ts` — `POST /api/files/upload` (multipart, multiple files, per-file type/size validation), `GET /api/files/:id`, `GET /api/files/:id/download`, `GET /api/files/:id/preview`, `DELETE /api/files/:id`.
- [ ] Link uploaded files to `documents` rows (the document carries `file_name`, `file_path`, `file_size`, `mime_type`).
- [ ] On DB-write failure, remove the just-written file.

### T3.3 Frontend upload
- [ ] `src/components/documents/DocumentFormDialog.tsx` — upload the real file (multipart) instead of base64/metadata-only.
- [ ] Preview + download buttons call the new endpoints.

**Exit criteria:** upload a PDF → file exists on disk under `UPLOADS_DIR` → preview and download both work → the file survives a container restart when the volume is mounted.

---

## Phase 4 — SMTP, expiry report, cron

### T4.1 Mailer
- [ ] `server/services/mailer.ts` — nodemailer transport built from env; `sendMail({to, cc, bcc, subject, text, html, attachments})`; clear error when SMTP is not configured.
- [ ] `server/services/templates.ts` — HTML + plain-text bodies for the expiry report; the plain-text part is the multipart alternative (never HTML-only).

### T4.2 Expiry service
- [ ] `server/services/expiryService.ts` — `collectExpiring(windowDays)` → employees (residency) + documents (expiry), grouped expired / expiring soon, each with days remaining and the related names.
- [ ] `sendExpiryReport({ triggerSource })` — build → send → write `email_log` → update `cron.last_run_at` / `cron.last_run_result`. Never throws out; errors become `email_log` rows with `status='failed'`.

### T4.3 Cron
- [ ] `server/services/cronService.ts` — node-cron; schedule read from settings; `reschedule()` called after every settings save; overlap guard; same-day guard for automatic runs.
- [ ] `server/routes/cron.ts` — `GET /api/cron/status` (schedule, next run, last run, result), `PUT /api/cron/schedule`.

### T4.4 Email routes
- [ ] `server/routes/email.ts` — `POST /api/email/test`, `POST /api/email/expiry-report`, `POST /api/email/send-documents`, `GET /api/email/log`.
- [ ] `POST /api/email/send-documents` — validate recipients, read files from the bucket, enforce the attachment size cap, attach, send, log.
- [ ] Missing files are reported explicitly, not silently skipped.

**Exit criteria:** "send expiry report now" delivers to all configured recipients and appears in `email_log`; the cron job fires at the configured time; the schedule can be changed from Settings without a restart.

---

## Phase 5 — Email documents UI

### T5.1 Single document
- [ ] Row action "Email" in the documents table → `SendDocumentDialog` with one document pre-selected.

### T5.2 Bulk
- [ ] Checkbox column in the documents table + `DocumentBulkActions` bar showing the selection count.
- [ ] "Email selected (N)" opens the same dialog with N documents.

### T5.3 Dialog
- [ ] `src/components/documents/SendDocumentDialog.tsx` — to / cc / bcc inputs, subject, body, attachment list with per-file size, live total size, disabled state when over the cap, result toast.

**Exit criteria:** one document and a batch of three both email successfully with real attachments.

---

## Phase 6 — Settings UI & i18n

### T6.1 Components
- [ ] `src/components/settings/EmailSettings.tsx` — rewrite: master toggle, recipients tag input, CC, sender name, test-send button.
- [ ] `src/components/settings/CronSettings.tsx` — new: enable, cron expression + human-readable preview, look-ahead days, include flags, next/last run, run-now button.
- [ ] `src/components/settings/SmtpSettings.tsx` — new: read-only env-derived host/port/user, "configured" badge, test-send.
- [ ] `src/components/settings/types.ts` — extend with the new setting shapes.

### T6.2 Translations
- [ ] Split `src/translations/en.ts` → `src/i18n/en/{common,employees,documents,settings,dashboard}.ts`; same for `ar.ts`. Keep `src/translations/index.ts` as the merge point so existing imports keep working.
- [ ] Add all new keys to **both** languages.

**Exit criteria:** every new string exists in `en` and `ar`; the build reports no duplicate keys; each new file ≤ 500 lines.

---

## Phase 7 — The 500-line refactor

### T7.1 Employees
- [ ] `src/pages/Employees.tsx` → thin page (< 200 lines).
- [ ] `src/components/employees/EmployeesTable.tsx`, `EmployeeFormDialog.tsx`, `EmployeeFilters.tsx`, `EmployeeCard.tsx` (existing, adapt).

### T7.2 Documents
- [ ] `src/pages/Documents.tsx` → thin page.
- [ ] `src/components/documents/DocumentsTable.tsx`, `DocumentFilters.tsx`, `DocumentFormDialog.tsx`, `DocumentFormFields.tsx`, `SendDocumentDialog.tsx`, `DocumentBulkActions.tsx`.
- [ ] `src/pages/EmployeeDocuments.tsx` + `src/components/documents/EmployeeDocumentsView.tsx`.
- [ ] `src/pages/CompanyDocuments.tsx` + `src/components/documents/CompanyDocumentsView.tsx`.

### T7.3 Employee profile
- [ ] `src/pages/EmployeeProfile.tsx` + `src/components/employees/EmployeeProfileView.tsx`.

### T7.4 Verify
- [ ] `npm run check:sizes` passes; every listed file ≤ 500 lines.
- [ ] Build + lint clean; manual smoke test of every route.

**Exit criteria:** no file under `src/` (excluding `src/components/ui/*` vendor files) exceeds 500 lines.

---

## Phase 8 — Docker & Dokploy

### T8.1 Image
- [ ] `Dockerfile` — multi-stage: builder (`node:24-alpine`, `npm ci`, `vite build`) → runtime (`node:24-alpine`, production deps only, `node server/index.js`).
- [ ] The SPA is served by the Node process → nginx layer removed; `nginx.conf` deleted.
- [ ] Non-root user (uid 1001), `DATA_DIR` created and owned by that user.
- [ ] `.dockerignore` updated (exclude `node_modules`, `dist`, `.git`, `data`, `supabase`).

### T8.2 Compose
- [ ] `docker-compose.yml` — app service, `ports`, `environment`, `volumes: [/opt/romani/data:/data]`, `restart: unless-stopped`.

### T8.3 Docs
- [ ] `docs/DOKPLOY.md` — step by step: host prep (`mkdir /opt/romani/data`), Dokploy app creation, env vars (incl. the Gmail app password), the **bind mount for the file bucket**, domain + port, first-boot verification, backup/restore of DB + files, and troubleshooting.

**Exit criteria:** `docker compose up --build` starts a working app; files and DB land in the host directory, not in the container layer.

---

## Phase 9 — Seed, verification, cleanup

### T9.1 Seed
- [ ] `server/db/seed.ts` — import `data/seed.json` (20 employees, 3 documents, catalogs) when tables are empty; insert the 2 admins with bcrypt hashes; idempotent.
- [ ] Verify the 20-employee dataset actually loads (the old browser seed only had 3).

### T9.2 Verification
- [ ] Boot on a clean volume → schema + seed applied.
- [ ] Login as **both** admins; wrong password rejected.
- [ ] Full CRUD on employees and documents; survives restart.
- [ ] Upload → file on disk → preview + download.
- [ ] Expiry report → SMTP delivery (with the real app password once provided) → `email_log` row.
- [ ] Cron fires on schedule → `email_log` row → no double-send on restart.
- [ ] Single + bulk document email with attachments.
- [ ] `npm run build` + `npm run lint` + `npm run check:sizes` all clean.

### T9.3 Cleanup
- [ ] Delete `src/lib/jsonDatabase.ts`, `src/integrations/`, `supabase/`, `public/data/database.json`, `data/database.json` (superseded), `MIGRATION_NOTES.md` (Supabase migration history), `acli.exe` (16 MB binary committed to the repo).
- [ ] Update `README.md` — new architecture, setup, Docker, Dokploy, admin accounts, the 500-line rule.
- [ ] Update `AGENTS.md` / `CLAUDE.md` (they currently only contain Byterover instructions).
- [ ] Remove the hardcoded Supabase key from git history guidance in the PR description (the key is already dead, but it is in history).

**Exit criteria:** all acceptance criteria in SPEC §15 pass; PR opened against `main` with a clear description and a Dokploy runbook.

---

## Risks to watch during execution

| Risk | Trigger | Response |
|---|---|---|
| Frontend migration breaks a page | build error or runtime error in Phase 2 | migrate one file at a time; keep the old `jsonDatabase` importable until the last page is converted |
| SQLite lock contention | `SQLITE_BUSY` under concurrent writes | WAL + `busy_timeout`; wrap writes in transactions |
| Gmail rejects a large attachment | `email_log` shows `failed` with a size error | enforce the cap in the UI **and** the API |
| Cron double-sends | restart during the daily window | persisted same-day guard |
| A file lands outside `UPLOADS_DIR` | traversal attempt | resolved-path assertion in the storage service |
| Node's `node:sqlite` API differs across versions | build/runtime error on Node 24 in Alpine | pin `node:24-alpine` in the Dockerfile and test the container locally before deploying |

---

## Revision log

### Round 1 → Round 2

The order was reshaped into **vertical slices that each build**, and the following
changes were made to the plan and the implementation:

| Plan item | Change |
|---|---|
| T0.1 | `npm run build` now compiles the client **and** the server (`build:client`, `build:server`); `npm run typecheck` covers both tsconfigs. The Docker image copies `server-dist`, the SQL migrations and `data/seed.json`. |
| T0.3 | The boot check now requires the host-prepared `.romani-volume` marker in production — a writable `/data` proves nothing. |
| T0.5 | The Supabase removal moved to **after** the last importer, because `useAuth` and `emailService` still referenced it during the earlier phases. |
| T1.1 | The phrase "safe select projection" is gone: `select` is a relation-inclusion directive, never a projection. The storage columns are rejected by the generic CRUD. |
| T2.3 | The PATCH contract is now explicit — an absent key keeps the value, `null` clears it — and the update forms were changed to send `null`. |
| T3.1–T3.3 | The public upload endpoint became a **staged** upload (`upload_id`), and `DocumentService` owns the file lifecycle. There is no static file route. |
| T4.2–T4.3 | The email attempt is logged **before** SMTP with the states `sent / partial / failed / skipped`; exactly-once is explicitly not promised. |
| T4.4 | Added `GET /api/email/expiry-preview`, which uses the same collector as the send, so the Settings preview and the real report can never disagree. |
| T9.1 | The seed is guarded by the `system.seed_version` marker instead of row counts. |
| T7 | The 500-line check runs on every file under `src/` and `server/`. The vendored shadcn primitives in `src/components/ui/` are excluded as a directory, because they are generated, are not hand-edited, and splitting them would only make them harder to update. |

### Added after round 1 (new user requirements)

| Plan item | Change |
|---|---|
| New §8.2.1 | Five reminder intervals (90 / 30 / 15 / 7 / 1 days), each independently selectable, with per-item deduplication in `expiry_notifications`. |
| New §8.4 | The expiry report is Arabic (RTL) with a teal design and the full document details. `email.language` switches it to English. |
| New §9 | "Send document" for a single document and for a multi-selected batch, with the real files attached. |
| New §6.1.1 | The staged-upload contract (`upload_id`), so a client can never point a record at a path of its choosing. |

### Round 2 — the revisions that were applied

| Plan item | Change |
|---|---|
| T4.2 | The collector buckets an item by the **smallest** selected threshold that has been reached, and `cron.days` no longer acts as a second eligibility window. Already-expired items are collected too. |
| T4.2 | The notification identity is `(item_type, item_id, expiry_date, interval_days, recipient)` — migration `005_notification_identity.sql`. A renewed document starts a new cycle; a refused recipient is retried on its own. |
| T4.1 | The mailer returns `accepted` and `rejected`; the log state becomes `sent` or `partial`, and only the accepting recipients are marked as notified. |
| T4.2 | The expiry report reads the Arabic catalogue names (`name_ar`) in the Arabic version, and the status pill shows the status **and** the days left. |
| T9.1 | The importer fills the missing audit columns, keeps the original `id` and timestamps, clears the stale `file_path` of the seeded documents, and aborts the whole import on the first bad row. |
| T9.2 | The erase also removes the files, the staged uploads and the notification records, and writes the marker. |
| T1.4 | The server-owned columns are refused with `400 managed_field`; `id` is immutable. |
| T1.4 | The document writes live in their own router, so the row write and the upload claim share one transaction. |
| T4.4 | The settings endpoint has a strict editable whitelist and rejects the whole request when one value is invalid; the rejected keys come back in the error payload. |
| T1.3 | Every mutation requires the administrator role, and the role is re-read from the database. `trust proxy` is only enabled when `TRUST_PROXY=true`. |
| T1.1 | Boolean and null filters are coerced to the column type; an offset without a limit writes `LIMIT -1`. |
| T9.2 | The verification suite grew to 47 assertions and now checks the whole upload → claim → download → delete chain. |

### Round 3 — the defects the verification suite exposed

| Plan item | Change |
|---|---|
| T9.1 | The seed aborted on `ministries.updated_at` — the export does not carry the audit columns. The importer fills them when the row has none. |
| T1.4 | A create answered with an object while the client's `insert()` expects a list, and it skipped the read shaping. Both were fixed: every create answers with `data: [ … ]`, shaped like a read. |
| T4.2 | The expiry report was split into `expiryReport.ts` (subject and text) and `expiryReportHtml.ts` (the HTML body), with the shared helpers in `shared.ts`, so no template file grows past the 500-line rule. |
| T9.2 | The email log moved into `server/services/emailLog.ts`, and the size check excludes the vendored `src/components/ui/` primitives. |
