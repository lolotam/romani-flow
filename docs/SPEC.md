# ROMANI Flow — Technical Specification

**Version:** 1.0
**Date:** 2026-11-02
**Branch:** `feature/sqlite-backend`
**Base:** `origin/main` @ `ccdd6be` ("Refactor dashboard components")

---

## 1. Problem statement

The application currently has **no real database**.

| Layer | Current state | Problem |
|---|---|---|
| Storage | `src/lib/jsonDatabase.ts` — whole dataset in browser `localStorage` under key `romani_json_database` | Per-browser data. Two users see different data. No server-side truth. Quota-limited (~5 MB). Files stored as base64 or dropped entirely. |
| Auth | `origin/main` migrated to Supabase (`src/integrations/supabase/client.ts`) | **The Supabase project no longer exists.** `xwgdkbulehhtrjjoglkb.supabase.co` returns `NXDOMAIN` from 1.1.1.1, 8.8.8.8 and the local resolver — identical to a deliberately bogus domain, while `api.supabase.com` resolves normally. Login and the expiry Edge Function are therefore both dead on `origin/main`. |
| Migrations | 9 files under `supabase/migrations/` | Target a dead project. Two files (`20250827073311`, `20250827073330`) are byte-identical, so a fresh apply fails on "table already exists". |
| Email | `src/lib/emailService.ts` calls a Supabase Edge Function | Dead dependency. No SMTP, no attachments, no scheduling. |
| Files | Metadata only; `file_path` points at dead Supabase Storage | Uploads are not actually persisted server-side. |
| Deploy | Static SPA behind nginx (`Dockerfile`, `nginx.conf`) | No server process, no volumes, no persistence across redeploys. |

**Goal:** replace all of the above with a self-contained Node.js + SQLite backend that owns its own data, its own files, and its own mail, deployable to Dokploy as a single container with a host-mounted volume.

## 2. Goals & non-goals

### Goals
- **G1** — Server-side SQLite database inside the project, single source of truth, shared by all admins.
- **G2** — Real file persistence in a directory **outside the container**, mounted from the Dokploy host.
- **G3** — Scheduled document-expiry reminders via SMTP, to multiple recipients, configurable from Settings.
- **G4** — Send one or many documents to one or many recipients by email, with real file attachments.
- **G5** — Two named admin accounts, seeded with bcrypt hashes.
- **G6** — Clean, maintainable, scalable code. **No new or refactored source file exceeds 500 lines.**
- **G7** — No regressions: every existing page keeps working.

### Non-goals
- Multi-tenancy / row-level per-user data scoping (single-tenant internal tool).
- Horizontal scaling — SQLite + one container is the target topology.
- Replacing the Vite/React SPA shell or the teal design system introduced on `origin/main`.

## 3. Target architecture

```
                    ┌──────────────────────────────────────────────┐
   Browser  ──────► │  Node 24 container (single process)          │
   (SPA)            │                                              │
                    │  Express app                                 │
                    │   ├── /api/*      JSON REST API               │
                    │   ├── /files/*    file streaming              │
                    │   └── /*          static SPA (dist/)          │
                    │                                              │
                    │  node:sqlite ──► ${DATA_DIR}/romani.db       │
                    │  storage svc ──► ${UPLOADS_DIR}/yyyy/mm/...  │
                    │  node-cron ────► expiry reminder job         │
                    │  nodemailer ───► SMTP (Gmail app password)    │
                    └──────────────┬───────────────────────────────┘
                                   │  bind mount
                                   ▼
                     Dokploy host: /opt/romani/data
                        ├── romani.db        (SQLite, WAL)
                        └── uploads/         (file bucket)
```

### 3.1 Why `node:sqlite`

- **Zero native compilation.** `better-sqlite3` needs a toolchain in `node:24-alpine`; `node:sqlite` is built into Node 24. Verified working locally: `new DatabaseSync(':memory:')` → `CREATE TABLE` → `prepare().run()/.all()`.
- Synchronous API → simple, fast, no pool. SQLite is a single-writer engine; the synchronous driver is the *correct* model, not a compromise.
- Node 24 LTS is the runtime; `node:sqlite` is stable there.

### 3.2 Data directories

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `/data` | Root of the persistent volume. SQLite file lives here. |
| `UPLOADS_DIR` | `${DATA_DIR}/uploads` | The "bucket". Overridable so it can be a **separate** mount. |
| `DB_PATH` | `${DATA_DIR}/romani.db` | Overridable for tests. |

Both default **inside one mount point**, so a single Dokploy volume gives persistence for DB *and* files. They are separate variables so an operator can mount them independently (e.g. files on a big disk, DB on fast local SSD).

### 3.3 Container layout

```
/app
├── dist/                 # built SPA (static)
├── server/               # compiled server (JS)
├── package.json
└── node_modules/         # production deps only

/data                     # ← the only persistent, host-mounted path
├── romani.db
└── uploads/
```

## 4. Data model (SQLite)

Migration files live in `server/db/migrations/` as ordered `.sql` files, applied by a tiny runner that records applied versions in `schema_migrations`. Statements are executed inside a transaction; the runner is idempotent (safe to run on every boot).

### 4.1 Tables

```sql
-- companies
id TEXT PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '',
description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL

-- ministries
id TEXT PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '',
created_at TEXT NOT NULL, updated_at TEXT NOT NULL

-- document_types
id TEXT PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '',
created_at TEXT NOT NULL, updated_at TEXT NOT NULL

-- positions
id TEXT PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT NOT NULL DEFAULT '',
value TEXT NOT NULL

-- employees
id TEXT PRIMARY KEY, company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
name TEXT NOT NULL, phone TEXT, mobile_no TEXT, email TEXT,
hire_date TEXT, birth_date TEXT, civil_id_no TEXT,
residency_expiry_date TEXT, position TEXT, position_id TEXT REFERENCES positions(id) ON DELETE SET NULL,
is_active INTEGER NOT NULL DEFAULT 1,
driving_license TEXT, driving_license_expiry_date TEXT,
photo_path TEXT,                     -- avatar file in the bucket, replaces the base64 column
created_at TEXT NOT NULL, updated_at TEXT NOT NULL

-- documents
id TEXT PRIMARY KEY, title TEXT NOT NULL,
file_name TEXT, file_path TEXT,          -- relative to UPLOADS_DIR
file_size INTEGER, mime_type TEXT,
status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','expiring_soon','expired')),
issue_date TEXT, expiry_date TEXT, notes TEXT,
employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
company_id   TEXT REFERENCES companies(id)   ON DELETE SET NULL,
document_type_id TEXT NOT NULL REFERENCES document_types(id) ON DELETE RESTRICT,
ministry_id  TEXT REFERENCES ministries(id) ON DELETE SET NULL,
created_at TEXT NOT NULL, updated_at TEXT NOT NULL

-- admin_users
id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin',
is_active INTEGER NOT NULL DEFAULT 1, last_login_at TEXT,
created_at TEXT NOT NULL, updated_at TEXT NOT NULL

-- settings  (key/value app configuration)
key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL

-- email_log  (audit trail of every send attempt)
id TEXT PRIMARY KEY, kind TEXT NOT NULL,       -- 'expiry_report' | 'documents' | 'test'
recipients TEXT NOT NULL, subject TEXT, status TEXT NOT NULL,  -- 'sent' | 'failed' | 'skipped'
error TEXT, attachment_count INTEGER NOT NULL DEFAULT 0,
trigger_source TEXT,                          -- 'cron' | 'manual'
created_at TEXT NOT NULL
```

### 4.2 Columns the UI needs but the current types do not declare

Recon of every call site found fields that are written and read but absent from `src/lib/jsonDatabase.ts`'s interfaces. They are added to the schema and to the shared types:

| Entity | Field | Where it is used today |
|---|---|---|
| `employees` | `is_active` | `src/pages/Employees.tsx:146-149` (write), `src/pages/Dashboard.tsx:171-179` (read) |
| `employees` | `driving_license` | `src/pages/Employees.tsx:146-149` |
| `employees` | `driving_license_expiry_date` | `src/pages/Employees.tsx:146-149` |
| `employees` | `photo` → `photo_path` | `src/pages/EmployeeDocuments.tsx:411-416` writes a **base64 blob** into the row; replaced by a real file in the bucket |
| `documents` | `file_size`, `mime_type` | needed for the email-attachment size accounting (SPEC §9.2) |

`document_count` is **never persisted** — it is computed in the browser (`src/pages/Documents.tsx:195-202`, `src/pages/Employees.tsx:423`). It stays a computed value so the page logic is unchanged.

### 4.3 Nullable columns and date formats

- Several columns are written as `null` by the forms (`src/components/DocumentForm.tsx:215`, `:252`; `src/components/EmployeeDocumentForm.tsx:142-143`), so every optional column is nullable in SQLite.
- **Two date formats are in play**: `YYYY-MM-DD` for business dates (`issue_date`, `expiry_date`, `residency_expiry_date`, `hire_date`, `birth_date`) and ISO-8601 with timezone for `created_at` / `updated_at`. The seed data mixes offsets. The server **normalises business dates to `YYYY-MM-DD`** on write and compares them as plain date strings — SQLite compares `TEXT` lexicographically, which is correct for ISO dates. `src/lib/statusUtils.ts:6` currently parses with a `'T00:00:00'` suffix hack; that is replaced by the shared date helper.

### 4.4 Referential integrity

There is **no** referential integrity today and the UI compensates for it in JavaScript — `src/pages/Dashboard.tsx:86-95` explicitly drops employees with a dangling `company_id` and documents with a dangling `employee_id`/`company_id`. Deleting a company (`src/pages/Settings.tsx:159`) leaves orphan employees.

The SQLite schema **does** use foreign keys with `ON DELETE SET NULL`, so the orphaned rows disappear on delete. The dashboard's defensive filter is kept (it becomes a no-op) so the counts do not silently shift during the migration.

`employees.position` stores the Arabic `positions.value` string, not `position_id` (`src/pages/Employees.tsx:562`); `position_id` exists in the type but is never written. Both are kept for compatibility, with `position` remaining the source of truth for display.

### 4.5 Indexes

```sql
CREATE INDEX idx_employees_company    ON employees(company_id);
CREATE INDEX idx_employees_residency  ON employees(residency_expiry_date);
CREATE INDEX idx_documents_employee   ON documents(employee_id);
CREATE INDEX idx_documents_company    ON documents(company_id);
CREATE INDEX idx_documents_type       ON documents(document_type_id);
CREATE INDEX idx_documents_ministry   ON documents(ministry_id);
CREATE INDEX idx_documents_expiry     ON documents(expiry_date);
CREATE INDEX idx_email_log_created    ON email_log(created_at DESC);
```

### 4.6 Document status

Status is **derived**, never trusted from the client. It is recomputed on every write and by a nightly maintenance pass:

```
expiry_date IS NULL              → 'valid'
expiry_date <  today              → 'expired'
expiry_date <= today + 30 days   → 'expiring_soon'
otherwise                        → 'valid'
```

The 30-day window is a setting (`expiry_warning_days`), not a magic constant.

### 4.7 Seed data

`data/seed.json` (copied from the full Supabase export: 20 employees, 3 documents, 2 companies, 5 ministries, 8 document types, 6 positions) is imported on the **first** boot.

The import is guarded by a permanent marker, **not** by row counts:

- `settings['system.seed_version'] = '1'` is written **inside the same transaction** as the data, so the marker and the data can never disagree.
- If the marker is present, the seed is skipped entirely — **deleting every row never brings the old data back**.
- If the database already contains data but has no marker, the seed **refuses to merge** and logs a clear diagnostic instead of silently mixing old and new rows.
- The import happens in one transaction, catalogs first, then employees, then documents, so a foreign-key violation rolls the whole import back.

The seed preserves the historical ids and timestamps of the original records instead of pushing them through the CRUD path (which would overwrite `created_at`).

The three seeded documents point at files that lived in the dead Supabase storage. They are imported **without** an attachment; the UI shows them as "no file" and offers an upload.

## 5. Authentication & authorisation

### 5.1 Model
- Email + password. Passwords hashed with **bcryptjs** (pure JS — no native build in Alpine).
- Login issues a **JWT (HS256)** stored in an `httpOnly`, `SameSite=Lax`, `Secure`-in-production cookie named `romani_session`, 12 h expiry.
- `JWT_SECRET` comes from env. If unset in production the server **refuses to boot** (no insecure default).
- All `/api/*` routes except `/api/auth/login` and `/api/health` require a valid session.
- **Role model.** There is none today — `src/components/ProtectedRoute.tsx:9-25` grants full access to any authenticated user, and the data layer is entirely unauthenticated. A minimal model is added: every `admin_users` row has a `role` (`admin` | `viewer`), `requireAuth` guards every `/api` route, and `requireAdmin` guards mutations and settings. The client only ever creates `admin` users, so the distinction is groundwork rather than a UI feature.

### 5.2 Seeded admins

| Email | Password | Role |
|---|---|---|
| `dr.vet.waleedtam@gmail.com` | `@Xx123456789xX@` | admin |
| `Room_samer20105@yahoo.com` | `@Xx123456789xX@` | admin |

Both are inserted by the seed script with bcrypt hashes generated at seed time. The seed is **idempotent**: existing admins are left untouched, missing ones are inserted, and `ADMIN_SEED_EMAILS` / `ADMIN_SEED_PASSWORD` env vars allow overriding the defaults at boot.

### 5.3 What is removed
- `src/integrations/supabase/client.ts` and `types.ts` — deleted.
- `src/hooks/useAuth.tsx` — rewritten against the new API.
- The hardcoded credential check in the old `useAuth` (`username === 'admin' && password === '@Xx123456789xX@'`) — gone.
- `public/data/database.json` — no longer used by the client (kept in the repo as the source for the seed import).
- `src/hooks/useCompanies.ts` — **dead code**, no importers. Deleted rather than migrated, because it would otherwise break silently when the module it imports is replaced.
- `src/pages/CompanyEmployees.tsx` — **dead page**, not routed in `src/App.tsx`. Deleted.
- The legacy `admin_users` seed row (`username: "Admin"`, `public/data/database.json:237-244`) — **not** carried into SQLite. The table is re-created with the email-based schema and the two admins above.

## 6. API design

### 6.1 Resource routes

All list endpoints support the same query-string contract:

```
GET /api/employees?select=*,companies(*)&eq[company_id]=<id>&like[name]=%ahmed%
                      &order=name:asc&limit=50&offset=0
```

Supported filters: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like` (`%` wildcard, case-insensitive), `in` (comma-separated). `order` is `field:asc|desc`. `limit`/`offset` paginate.

**`select` semantics (verified against the current client — these are load-bearing):**

1. `select()` is **not a column projection**. In the current implementation `selectFields` is stored but never used to filter columns (`src/lib/jsonDatabase.ts:227`, `:291`). Every row comes back complete. The new API must behave the same way, otherwise reads such as `doc.companies?.description` break.
2. `select` is only a **relation-inclusion directive**. The current implementation triggers the embed path when the select string contains `(` (`src/lib/jsonDatabase.ts:299`). A select of `'*, companies (name, name_ar)'` embeds the **entire** company row, not just the named columns.
3. Relations are returned as **nested objects under plural keys**: `companies`, `employees`, `document_types`, `ministries` (`src/lib/jsonDatabase.ts:336-373`). `employees` additionally carries a **nested** `companies` object (`src/lib/jsonDatabase.ts:350-355`).
4. The trigger is a plain substring test, so any select text mentioning a relation name enables it. The new API parses `relation(cols)` tokens properly but resolves to the same key names and whole-object shape.

**Mutation semantics (must match):**

| Operation | Contract |
|---|---|
| `insert` | accepts a bare object **or** an array; always returns an **array** (`src/lib/jsonDatabase.ts:403`, `:425`). `src/pages/Employees.tsx:157` depends on `data![0]`. |
| `insert` id | **the server now honours a client-supplied `id`.** The current client silently discards it (`src/lib/jsonDatabase.ts:406-409`), which makes `src/components/DocumentForm.tsx:229-239` write a ministry under a generated id and then reference a non-existent id. Honouring the id fixes that bug; the client code is corrected in the same change. |
| `insert` timestamps | `created_at` / `updated_at` are always set by the server, overriding client values. |
| `insert` status | for `documents` with an `expiry_date`, `status` is always recomputed server-side. |
| `update` | returns a **single object** (not an array); sets `updated_at`; recomputes `status` whenever `expiry_date` is present in the payload. **Changed**: status is now recomputed on **every** document update, so editing a title no longer leaves a stale status. |
| `delete` | returns `{ error }` only — no data. |
| errors | **never thrown** — always returned as `{ data: null, error }` (`src/lib/jsonDatabase.ts:328`, `:428`, `:457`, `:476`). Every call site does `if (error) throw error;`, so HTTP 4xx/5xx must be mapped into that envelope rather than rejecting the promise. |
| unknown table | returns an empty array, not `null`. |

Responses are always `{ data, error }` — the same envelope the current `jsonDatabase` returns, so the frontend swap is minimal.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` → sets cookie, returns user |
| POST | `/api/auth/logout` | clears cookie |
| GET | `/api/auth/me` | current user |
| GET/POST | `/api/companies`, `/api/ministries`, `/api/document-types`, `/api/positions`, `/api/employees`, `/api/documents` | list / create |
| GET/PATCH/DELETE | `/api/{resource}/:id` | read / update / delete |
| POST | `/api/files/upload` | multipart → **stages** files, returns `upload_id` values |
| PUT | `/api/documents/:id/file` | `{ upload_id }` → replaces the attachment |
| DELETE | `/api/documents/:id/file` | detaches the file, keeps the document |
| GET | `/api/files/:documentId` | metadata |
| GET | `/api/files/:documentId/download` | attachment download (authenticated) |
| GET | `/api/files/:documentId/preview` | inline preview (authenticated) |
| PUT/GET/DELETE | `/api/files/employees/:employeeId/photo` | the employee photo |
| GET/PUT | `/api/settings` | app settings (non-secret) |
| POST | `/api/email/test` | send a test email to verify SMTP |
| GET | `/api/email/expiry-preview` | what the next report would contain (same collector as the send) |
| POST | `/api/email/expiry-report` | trigger the expiry report now |
| POST | `/api/email/send-documents` | `{ document_ids[], to[], cc?, bcc?, subject?, message? }` |
| GET | `/api/email/log` | recent sends (audit) |
| GET | `/api/cron/status` | schedule, next run, last run |
| PUT | `/api/cron/schedule` | update cron schedule |
| GET | `/api/backup/export` | full DB export as JSON (replaces the localStorage backup) |
| POST | `/api/backup/erase` | wipe all data (replaces `localStorage.removeItem` + reload) |
| GET | `/api/health` | liveness + DB check |

**No static file route exists.** There is no `/files/*` directory that the web server publishes: every read goes through an authenticated endpoint that resolves the file from the record that owns it.

### 6.1.1 The staged-upload contract

A client never writes a storage path. It uploads the bytes and receives an
`upload_id`:

```
POST /api/files/upload   (multipart)   →  [{ upload_id, file_name, file_size, mime_type, original_name }]
POST /api/documents      { …, upload_id }        → the server resolves and claims it
PUT  /api/documents/:id/file { upload_id }        → replaces the attachment
```

The storage columns (`file_name`, `file_path`, `file_size`, `mime_type`) are
rejected by the generic CRUD endpoints; only the document service writes them.

**Backup and erase are currently browser-local operations** and must move to the server:

- "Export backup" (`src/pages/Settings.tsx:205-228`) reads five tables from localStorage and writes `{ timestamp, version: '1.0', data: { documents, employees, companies, document_types, ministries } }` — **`positions` is missing from the current export** (`src/pages/Settings.tsx:214`). The server export includes `positions` and `admin_users` (without hashes).
- "Erase all data" (`src/pages/Settings.tsx:230-236`) removes the localStorage key and reloads. The server version truncates the data tables inside a transaction. It is guarded by `requireAdmin` and by the existing confirmation dialog.
- **Reminder dismissals** live in localStorage under `romani_deleted_reminders` (`src/pages/Settings.tsx:75`, `:112`) and `pinnedReminders` / `deletedReminders` (`src/pages/Dashboard.tsx:49`, `:59`, `:71-72`) — **the Dashboard and the Settings page use different key names**, so dismissing a reminder in one does not affect the other. Both move into the `settings` table under a single key, which fixes that inconsistency.

### 6.2 Client drop-in

`src/lib/api/` replaces `src/lib/jsonDatabase.ts` with the **same fluent surface**:

```ts
const { data, error } = await api.from('employees').select('*').eq('company_id', id).execute();
const { data } = await api.insert('employees', { name, company_id });
const { data } = await api.update('employees', id, { name });
const { error } = await api.delete('employees', id);
```

This keeps the 6 page files that call it working with near-zero churn, and confines the storage swap to one module. `src/lib/api/queryBuilder.ts` turns the fluent chain into query parameters; `src/lib/api/client.ts` performs the fetch and normalises errors.

## 7. File storage ("the bucket")

### 7.1 Layout on disk

```
${UPLOADS_DIR}/
└── 2026/
    └── 11/
        └── 9f1c…-residency-cert.pdf
```

`yyyy/mm` bucketing keeps directories small. The stored `file_path` is **relative** to `UPLOADS_DIR`, so the volume can be remounted at a different path without touching the database.

### 7.2 Upload rules
- Accepted types are configurable (`ALLOWED_FILE_TYPES`, default: pdf, images, doc/docx, xls/xlsx, txt, csv).
- Max size configurable (`MAX_UPLOAD_MB`, default 25) — bounded by Gmail's 25 MB attachment ceiling.
- Filenames are sanitised; the stored name is `<uuid>-<sanitised-original>`.
- Uploads land on disk **before** the DB row is written; a failed DB write removes the orphaned file.

**The two current document forms behave differently, and both are wrong:**

| Form | Today | Problem |
|---|---|---|
| `src/components/DocumentForm.tsx:192`, `:208` | reads the file with `FileReader` and stores the **base64 data URL** in `documents.file_path` | A 20 MB file becomes ~27 MB of base64 in the row — beyond the localStorage quota, so `saveDatabase` throws `'Failed to save database'` (`src/lib/jsonDatabase.ts:145`). The file is also unattachable by email. |
| `src/components/EmployeeDocumentForm.tsx:133` | stores a **fabricated path** `documents/<uuid>.<ext>` | The file is never stored anywhere; the record points at a file that does not exist. |

Both are replaced by a **real multipart upload** to `POST /api/files/upload`. The `documents` row keeps `file_name`, `file_path` (relative), `file_size` and `mime_type`; the blob never enters the database.

The employee avatar (`src/pages/EmployeeDocuments.tsx:411-416`, base64 in `employees.photo`) follows the same route and becomes `employees.photo_path`.

### 7.3 Serving
- `GET /api/files/:id/download` → `Content-Disposition: attachment`.
- `GET /api/files/:id/preview` → `Content-Disposition: inline` with a safe `Content-Type`; only whitelisted inline types are served inline, everything else forces download.
- Path traversal is impossible: the resolved path is verified to remain inside `UPLOADS_DIR` before any read.

### 7.4 Dokploy mount (the "bucket outside the container")

On the Dokploy host:

```bash
sudo mkdir -p /opt/romani/data/uploads
sudo chown -R 1001:1001 /opt/romani/data
```

In the Dokploy app → **Mounts / Volumes**:

| Type | Host path | Container path | Mode |
|---|---|---|---|
| Bind | `/opt/romani/data` | `/data` | rw |

The container's data dir is `/data`; `UPLOADS_DIR` then resolves to `/data/uploads` — on the host, **outside the container**. Full step-by-step in `docs/DOKPLOY.md`.

## 8. Email & cron

### 8.1 Transport
- **nodemailer** with a reusable SMTP transport.
- Configuration resolution order: **environment first** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`), then the `settings` table for **non-secret** keys only.
- **The SMTP password is never written to the database and never returned by the API.** The Settings UI shows "configured / not configured" and offers a *test send*. The operator supplies the password through Dokploy env vars, exactly as planned.
- Sender defaults to `samirfayez03@gmail.com` with a Gmail app password.

### 8.2 Settings (all editable in the UI)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `email.enabled` | bool | `true` | master switch |
| `email.recipients` | string[] | `[]` | primary recipients of the expiry report |
| `email.cc` | string[] | `[]` | CC on every automated send |
| `email.from_name` | string | `ROMANI Flow` | display name |
| `email.language` | `'ar'` \| `'en'` | `ar` | the report is Arabic (RTL) by default |
| `email.notification_intervals` | number[] | `[90,30,15,7,1]` | **the five reminder thresholds the admin can switch on and off** |
| `expiry_warning_days` | number | `30` | window for "expiring soon" |
| `cron.enabled` | bool | `true` | run the scheduled job |
| `cron.schedule` | string | `0 8 * * *` | 5-field cron, server timezone (`TZ`) |
| `cron.days` | number | `30` | look-ahead window for the report |
| `cron.include_employees` | bool | `true` | include residency expiries |
| `cron.include_documents` | bool | `true` | include document expiries |
| `cron.last_run_at` | string | — | written after each run |
| `cron.last_run_result` | string | — | `sent` / `failed` / `skipped` |
| `reminders.dismissed` | string[] | `[]` | reminders hidden in the UI (display only — it never suppresses an email) |
| `reminders.pinned` | string[] | `[]` | pinned reminders |

`cron.last_run_*`, `reminders.*` and any `system.*` key are server-owned and are **rejected** by the public settings endpoint. The SMTP password is never a setting at all.

### 8.2.1 The five reminder intervals

The administrator selects any combination of five thresholds in the Settings screen:

| Interval | Days before expiry | Arabic label |
|---|---|---|
| 3 months | 90 | قبل 3 أشهر |
| 1 month | 30 | قبل شهر واحد |
| 15 days | 15 | قبل 15 يوماً |
| 1 week | 7 | قبل أسبوع واحد |
| 1 day | 1 | قبل يوم واحد |

An item belongs to the **smallest selected interval it has reached** — an item that is 20 days away is notified under "1 month before", not under "15 days before". An item that has already expired belongs to its own bucket and is reported once.

Each notification is recorded in `expiry_notifications` (`item_type`, `item_id`, `interval_days`, unique), so an item is notified **once per threshold** no matter how often the daily job runs.

**Reminder dismissals never suppress an email.** Dismissing a reminder only hides it in the dashboard.

### 8.3 The scheduled job
- Driven by **node-cron** inside the API process.
- The schedule is re-read from the database on every tick, so changing it in Settings takes effect without a restart.
- A re-schedule happens whenever Settings are saved.
- **Overlap guard:** a `running` flag prevents a second run while one is in flight.
- **Failure isolation:** a failed send is caught, logged to `email_log`, and never crashes the API process.
- The job is idempotent per day: it records the last run date and skips a second automatic run on the same calendar day (a restart mid-day must not double-send).

### 8.4 Expiry report contents
- Employee residencies expiring within the window, with days remaining.
- Documents expiring within the window, with the employee's name and document type.
- Grouped by "expired" / "expiring soon".
- Both HTML and plain-text bodies (the text part is the multipart alternative).
- Sent to `email.recipients` + `email.cc`, as multiple recipients on one message (not BCC spam).

### 8.5 Manual triggers
- "Send expiry report now" in Settings → same service function, `trigger_source = 'manual'`, bypasses the same-day guard.

## 9. Sending documents by email

### 9.1 Feature
- In the Documents table: a **row action** "Email" → opens a dialog.
- A **multi-select** checkbox column → a bulk action bar appears with "Email selected (N)".
- The dialog collects: recipients (to / cc / bcc), subject, an optional body, and shows the selected documents with file names and sizes.
- Files are read from the bucket and attached as real MIME attachments.

### 9.2 Constraints & validation
- Total attachment size must stay under the provider limit (default 20 MB, configurable `MAX_EMAIL_ATTACHMENT_MB`) — the UI shows a live total and blocks oversized sends.
- Recipients are validated as a comma/newline-separated list of emails; invalid entries are reported per-field.
- A missing file on disk is reported, not silently skipped.
- Every attempt is written to `email_log` with recipient list, attachment count and outcome.

### 9.3 Endpoint
`POST /api/email/send-documents`

```jsonc
{
  "document_ids": ["…", "…"],
  "to": ["a@b.com", "c@d.com"],
  "cc": [], "bcc": [],
  "subject": "Documents",            // optional, defaults to a generated one
  "message": "Please find attached"  // optional HTML/text body
}
```

## 10. Frontend changes

### 10.1 Module map (new)

```
src/
├── lib/
│   ├── api/
│   │   ├── client.ts          # fluent drop-in over fetch  (< 250 lines)
│   │   ├── queryBuilder.ts    # fluent chain → query string (< 200 lines)
│   │   ├── http.ts            # fetch wrapper, error envelope (< 120 lines)
│   │   └── endpoints.ts       # typed calls for new features (< 200 lines)
│   └── emailService.ts        # REWRITTEN → calls the server, no SMTP in browser
├── hooks/
│   ├── useAuth.tsx            # REWRITTEN → cookie session
│   └── useDocuments.ts        # list/mutate documents
├── components/
│   ├── documents/
│   │   ├── DocumentsTable.tsx
│   │   ├── DocumentFilters.tsx
│   │   ├── DocumentFormDialog.tsx
│   │   ├── SendDocumentDialog.tsx     # NEW — single + bulk email
│   │   └── DocumentBulkActions.tsx    # NEW
│   ├── employees/
│   │   ├── EmployeesTable.tsx
│   │   ├── EmployeeFormDialog.tsx
│   │   └── EmployeeFilters.tsx
│   └── settings/
│       ├── EmailSettings.tsx          # REWRITTEN
│       ├── CronSettings.tsx           # NEW
│       └── SmtpSettings.tsx           # NEW
├── features/
│   └── ... (page-level orchestration, kept thin)
└── i18n/                       # translations split by domain
    ├── en/{common,employees,documents,settings,dashboard}.ts
    └── ar/{common,employees,documents,settings,dashboard}.ts
```

### 10.2 The 500-line rule

Files currently over 500 lines on `origin/main` and their disposition:

| File | Lines | Action |
|---|---|---|
| `src/pages/Employees.tsx` | 1308 | Split → `pages/Employees.tsx` (thin) + `components/employees/*` |
| `src/pages/Documents.tsx` | 1032 | Split → `pages/Documents.tsx` + `components/documents/*` |
| `src/pages/EmployeeDocuments.tsx` | 997 | Split → `pages/EmployeeDocuments.tsx` + `components/documents/EmployeeDocumentsView.tsx` |
| `src/pages/CompanyDocuments.tsx` | 826 | Split → `pages/CompanyDocuments.tsx` + `components/documents/CompanyDocumentsView.tsx` |
| `src/components/DocumentForm.tsx` | 770 | Split → `components/documents/DocumentFormDialog.tsx` + `DocumentFormFields.tsx` |
| `src/pages/EmployeeProfile.tsx` | 690 | Split → `pages/EmployeeProfile.tsx` + `components/employees/EmployeeProfileView.tsx` |
| `src/translations/en.ts` | 870 | Split → `i18n/en/*.ts` |
| `src/translations/ar.ts` | 854 | Split → `i18n/ar/*.ts` |
| `src/components/ui/sidebar.tsx` | 761 | shadcn vendor file — leave untouched |
| `src/lib/jsonDatabase.ts` | 482 | Replaced by `src/lib/api/*` |

**Rule:** every file created or touched by this work ends at **≤ 500 lines**. New files target ≤ 300.

### 10.3 Translation keys

New keys follow the existing `en.ts` / `ar.ts` shape and are added to **both** languages. The two real duplicate-key bugs found in the build (`status` and `entityNamePlaceholder` duplicated inside the same object literal in both `en.ts` and `ar.ts`) are fixed as part of the split.

### 10.4 Settings UI
- `EmailSettings.tsx` — master toggle, recipients (tag input), CC, sender name, "send test email" button, last-send log.
- `CronSettings.tsx` — enable, cron expression with a plain-language preview, look-ahead days, include-employees / include-documents switches, next-run time, last-run result, "run now" button.
- `SmtpSettings.tsx` — shows host/port/user from env (read-only, masked), "configured" badge, test-send button.

## 11. Server implementation map

```
server/
├── index.ts                   # bootstrap: config → db → migrate → seed → cron → listen
├── config.ts                  # env parsing + validation (< 120 lines)
├── app.ts                     # express wiring, middleware, route mounting (< 150 lines)
├── db/
│   ├── connection.ts          # node:sqlite open + pragmas (WAL, foreign_keys) (< 80 lines)
│   ├── migrator.ts            # ordered .sql runner + schema_migrations (< 120 lines)
│   ├── seed.ts                # import export data + admins (< 200 lines)
│   └── migrations/
│       ├── 001_init.sql
│       ├── 002_indexes.sql
│       └── 003_email_log.sql
├── middleware/
│   ├── auth.ts                # JWT cookie → req.user (< 80 lines)
│   ├── errorHandler.ts        # uniform error envelope (< 80 lines)
│   └── validate.ts            # zod request validation (< 80 lines)
├── repositories/
│   ├── base.ts                # generic CRUD + filter/join builder (< 250 lines)
│   ├── employees.ts
│   ├── documents.ts
│   ├── catalog.ts             # companies / ministries / document_types / positions
│   ├── adminUsers.ts
│   └── settings.ts
├── routes/
│   ├── auth.ts
│   ├── catalog.ts
│   ├── employees.ts
│   ├── documents.ts
│   ├── files.ts
│   ├── settings.ts
│   ├── email.ts
│   └── cron.ts
├── services/
│   ├── storageService.ts      # bucket read/write/traversal-guard (< 200 lines)
│   ├── mailer.ts              # nodemailer transport + send helpers (< 200 lines)
│   ├── templates.ts           # HTML + text email bodies (< 250 lines)
│   ├── expiryService.ts       # compute expiring + build report (< 200 lines)
│   └── cronService.ts         # node-cron scheduling + guards (< 150 lines)
└── utils/
    ├── ids.ts, dates.ts, validation.ts
```

## 12. Deployment (Dokploy)

### 12.1 Dockerfile (multi-stage)
```
stage 1  node:24-alpine  → npm ci, vite build → /app/dist
stage 2  node:24-alpine  → npm ci --omit=dev (server deps), copy dist + compiled server
                          → CMD ["node","server/index.js"]
```
nginx is no longer needed as a separate container — the Node process serves the static build and proxies nothing. This removes a whole layer and lets the API and SPA share one origin (no CORS, same-site cookies work).

### 12.2 Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `3000` | |
| `DATA_DIR` | no | `/data` | volume mount point |
| `UPLOADS_DIR` | no | `${DATA_DIR}/uploads` | |
| `JWT_SECRET` | **yes in prod** | — | server refuses to boot without it in production |
| `SMTP_HOST` | for mail | `smtp.gmail.com` | |
| `SMTP_PORT` | for mail | `587` | |
| `SMTP_SECURE` | for mail | `false` | `true` for port 465 |
| `SMTP_USER` | for mail | `samirfayez03@gmail.com` | |
| `SMTP_PASS` | for mail | — | Gmail **app password**, set in Dokploy env |
| `SMTP_FROM` | for mail | `ROMANI Flow <samirfayez03@gmail.com>` | |
| `ADMIN_SEED_EMAILS` | no | the two admins | comma-separated |
| `ADMIN_SEED_PASSWORD` | no | `@Xx123456789xX@` | |
| `MAX_UPLOAD_MB` | no | `25` | |
| `MAX_EMAIL_ATTACHMENT_MB` | no | `20` | |
| `NODE_ENV` | no | `production` | |

### 12.3 Compose

```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      - NODE_ENV=production
      - DATA_DIR=/data
      - JWT_SECRET=…
      - SMTP_USER=…
      - SMTP_PASS=…
    volumes:
      - /opt/romani/data:/data     # ← the bucket + DB, outside the container
    restart: unless-stopped
```

## 13. Security

| Item | Treatment |
|---|---|
| SMTP password | env only — never persisted, never returned by the API |
| `JWT_SECRET` | env only — required in production |
| Passwords | bcryptjs, cost 10 |
| Session cookie | `httpOnly`, `SameSite=Lax`, `Secure` in production |
| Path traversal | resolved path verified to stay inside `UPLOADS_DIR` |
| SQL injection | parameterised statements everywhere; identifiers validated against an allow-list |
| Upload types / size | allow-list + configurable cap |
| Inline preview | only whitelisted types served inline |
| Secrets in repo | the committed Supabase keys are removed with the Supabase code |
| Rate limiting | login attempts throttled per IP |

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Big-bang frontend swap breaks pages | the fluent client keeps the call surface identical; page-by-page migration with a build after each step |
| Gmail 25 MB attachment ceiling | size accounting before send, blocked with a clear message |
| Cron double-sends after a restart | same-day guard persisted in settings |
| SQLite lock contention under load | WAL mode + single-writer model; this workload does not need more |
| Files orphaned if the DB write fails | file removed on DB failure |
| Dokploy volume not mounted | boot-time check: `DATA_DIR` must exist and be writable, else fail loudly |

## 15. Acceptance criteria

1. `npm run build` succeeds; no new file exceeds 500 lines; `npm run lint` is clean.
2. Server boots on a fresh volume, applies migrations, seeds 2 admins + the full 20-employee dataset.
3. Login as `dr.vet.waleedtam@gmail.com` and `Room_samer20105@yahoo.com` works; the wrong password is rejected.
4. All pages list real data from SQLite; creating/editing/deleting an employee or document persists across a server restart.
5. Uploading a file stores it under `${UPLOADS_DIR}` on disk (outside the container in Docker) and it can be previewed and downloaded.
6. "Send expiry report now" delivers an HTML + text email to all configured recipients via SMTP; the run appears in `email_log`.
7. The cron schedule fires automatically at the configured time and writes to `email_log`.
8. A single document and a multi-selected batch can both be emailed with real attachments.
9. The old localStorage database, the Supabase client and the dead Supabase migrations are gone.
10. `docs/DOKPLOY.md` explains the host volume mount end to end.
11. The five reminder intervals can each be switched on and off, and an item is notified **once per selected interval**.
12. The expiry report is Arabic, right-to-left, in the teal palette, and lists every document detail.
13. Deleting every row and restarting does **not** bring the seed data back.
14. The server refuses to start in production when the volume marker is missing.

---

## 16. Revision log

### Round 1 — Codex (`gpt-6.1-sol`, reasoning `high`)

| # | Finding | Resolution |
|---|---|---|
| 1 | The seed re-imported deleted data | Replaced the row-count check with the `system.seed_version` marker written inside the import transaction (§4.7) |
| 2 | A writable `/data` proves nothing — the container creates it | Production boot now requires the host-prepared `.romani-volume` marker (§12.4) |
| 3 | `ON DELETE SET NULL` hid documents instead of handling ownership | Ownership is now explicit: the document service deletes the record **and** its file; the UI shows a "no file" state instead of a vanishing row |
| 4 | Files had an unprotected side door | No static file route exists; uploads are staged and claimed by their owner (§6.1.1) |
| 5 | The file lifecycle had no single owner | `DocumentService` now owns create / replace / detach / delete and its cleanup ordering |
| 6 | "Exactly once" e-mail is not achievable | The attempt is logged **before** SMTP, states are `sent / partial / failed / skipped`, and the report never promises exactly-once (§8.3) |
| 7 | `undefined` fields silently kept their old value over HTTP | PATCH contract fixed: an absent key keeps the value, an explicit `null` clears it (§6.1) |
| 8 | The production build had no server path | `npm run build` now compiles the client **and** the server; the image copies the SQL migrations and the seed data (§12.1) |
| 9 | A free-form cron expression contradicted "once a day" | The schedule stays a 5-field cron with an explicit `TZ`, and the daily guard is persisted |
| 10 | The stored status drifted from the date | The status is now **derived on every read** from `expiry_date` and the current warning window (§4.6) |
| 11 | SQLite integers leaked into the UI | `is_active` and `driving_license` are `INTEGER … CHECK (IN (0,1))` and are mapped to booleans on read |
| 12 | The phase order could not meet its own build gates | The phases were reordered into vertical slices that each build (§15 of the plan) |

### Accepted as deliberate scope limits

- No ORM, no queue, no event bus, no separate worker process.
- No S3 abstraction — the bucket is a host directory, and the SQLite file must live on a filesystem with proper locking.
- No user-management groundwork: both seeded accounts are administrators.
- The JSON export is a **data export**; it does not include the uploaded files. The restorable backup is a copy of the storage root (§8 of the Dokploy guide).

### Round 2 — Codex (`gpt-6.1-sol`, reasoning `high`)

| # | Finding | Resolution |
|---|---|---|
| 1 | The five reminder intervals collapsed into one | `resolveBucket` now returns the **smallest** selected threshold that has been reached, so each interval is genuinely independent (§8.2.1) |
| 2 | `cron.days` acted as a second eligibility window and cancelled the wider thresholds | Removed — the selected intervals alone decide what is due |
| 3 | Expired items never reached the collector | Already-expired records are collected and reported as `منتهي / Expired` |
| 4 | The dedup key was too coarse | The identity is now `(item_type, item_id, expiry_date, interval_days, recipient)` — migration `005_notification_identity.sql` |
| 5 | A partially accepted message was reported as sent | The mailer returns `accepted` / `rejected`; the log state becomes `sent` or `partial`, and only the accepting recipients are marked as notified |
| 6 | A database that already had data could still be seeded later | The seed records the marker for such a database, and a single bad row aborts the whole import |
| 7 | Erasing the data left files, staged uploads and notification rows behind | The erase now removes the rows **and** the files, the staged uploads and the notification records, and writes the marker |
| 8 | Server-owned columns could be written by the client | `file_name`, `file_path`, `file_size`, `mime_type`, `status`, `photo_path` and `photo_mime_type` are refused with `400 managed_field`; `id` is immutable |
| 9 | The document writes bypassed the file lifecycle | Document writes moved to a dedicated router that goes through `DocumentService`, so the row write and the upload claim share one transaction |
| 10 | The settings endpoint accepted server-owned keys | It now has a strict editable whitelist, validates the intervals, the addresses and the cron expression, and rejects the **whole request** when one value is invalid (§8.2) |
| 11 | Any signed-in user could write | Every mutation requires the administrator role, and the role is re-read from the database rather than trusted from the token |
| 12 | `trust proxy` was unconditional | It is only enabled when `TRUST_PROXY=true`, so a direct client cannot spoof its address through `X-Forwarded-For` and defeat the login rate limiter |
| 13 | `public/data/database.json` was served statically | Deleted — the database is never published |
| 14 | Boolean and null filters never matched | Filter values are coerced to the column type, and an empty value compares with `IS NULL` / `IS NOT NULL` |
| 15 | An offset without a limit produced invalid SQL | The limit is always written (`LIMIT -1` when only an offset is given) |
| 16 | Invalid dates were stored as strings | `normalizeDate` rejects a date that is not a real calendar date |
| 17 | Upload and storage failures had no meaningful status | They are mapped to `409 / 413 / 415 / 404 / 400` (§13) |
| 18 | A batch with one bad document was sent half-empty | The whole batch is refused when an address is invalid or a document has no file (§9.2) |
| 19 | The size check ran against the MIME body | The encoded size is computed before SMTP, so the limit matches what is actually transmitted (§9.2) |

### Round 3 — defects found while running the verification suite

| # | Finding | Resolution |
|---|---|---|
| 1 | The seed aborted on `ministries.updated_at` — the export does not carry the audit columns | The importer fills `created_at` / `updated_at` when the row has none, and keeps the original values when it has |
| 2 | The seeded documents pointed at files that lived in the dead Supabase storage | The importer clears `file_path` and keeps `file_name`, so no download can point at a file that does not exist |
| 3 | A create answered with an object while the client's `insert()` expects a list | Every create answers with `data: [ … ]` |
| 4 | A create answered with raw SQLite integers while a read answered with booleans | The rows are shaped on the way out, exactly like a read |
| 5 | The expiry report never used the Arabic catalogue names | The Arabic report reads `name_ar` from companies, document types and ministries |
| 6 | The status pill hid the number of days | The pill shows the status **and** the days left; the text alternative carries the ministry, the issue date and the explicit status |
| 7 | The header gradient vanished in clients that drop `background-image` | The gradient is layered on top of a solid brand colour |
| 8 | The document table was unreadable on a narrow screen | The table was reduced to five columns inside a horizontally scrollable container |
