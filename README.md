# ROMANI Flow — Employee and Document Management

A bilingual (Arabic / English) web application for managing employees and their
documents, with expiry reminders delivered by email.

The application is a **Vite + React SPA served by a small Node API**. The API
owns a **SQLite database** and a **file bucket** that lives on a mounted volume
outside the container, so the data survives every rebuild.

---

## Features

### Employees
- Registration and editing with company, position, civil ID and residency expiry
- Search and filter by name, position, company and status
- Employee profiles with their documents and an uploaded photo

### Documents
- Upload with drag and drop — the real file is stored in the bucket, never as base64
- Categorisation by document type and ministry
- Expiry tracking with a derived status: valid, expiring soon, expired
- Preview and download through authenticated endpoints
- **Send one document, or a multi-selected batch, by email with the files attached**

### Reminders
- A daily scheduled job that reports expiring employee residencies and documents
- **Five reminder thresholds, each switchable on its own**: 3 months, 1 month, 15 days, 1 week and 1 day before expiry
- Multiple recipients and a CC list, configured in Settings
- The report is **Arabic and right-to-left** by default, in the same teal palette as the app
- Every send attempt is recorded and can be reviewed in Settings

### Administration
- Companies, ministries, document types and positions
- SMTP status and a connection test
- Cron schedule, look-ahead window and a manual "run now"
- Data export and a guarded "erase all data"
- Bilingual interface with full RTL support

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| UI | shadcn/ui, Tailwind CSS, Lucide icons, Framer Motion |
| Forms | React Hook Form + Zod |
| Routing | React Router DOM |
| Server | Node 24, Express 5 |
| Database | SQLite through the built-in `node:sqlite` driver |
| Files | A directory on a mounted volume (`node:fs`) |
| Mail | Nodemailer over SMTP (Gmail app password) |
| Scheduler | node-cron, inside the API process |
| Auth | bcryptjs + a signed JWT in an httpOnly cookie |

`node:sqlite` is used deliberately: it needs **no native compilation**, so the
Docker image stays small and the build never depends on a toolchain.

---

## Getting started

### Requirements

- Node.js 24 or newer
- npm

### Install and run

```bash
npm install
cp .env.example .env      # fill in JWT_SECRET and the SMTP password
npm run db:migrate
npm run db:seed
npm run server:dev        # API on http://localhost:3000
npm run dev               # SPA on http://localhost:8080
```

The SPA proxies `/api` to the server in development — see `vite.config.ts`.

### Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | the SPA in development mode |
| `npm run build` | builds the SPA **and** the server |
| `npm run typecheck` | type-checks both tsconfigs |
| `npm run lint` | ESLint + the 500-line file size check |
| `npm run check:sizes` | fails if a source file exceeds 500 lines |
| `npm run server:dev` | the API with hot reload |
| `npm run db:migrate` | applies pending SQL migrations |
| `npm run db:seed` | imports the reference data and the admin accounts |

---

## Configuration

Every variable is documented in [`.env.example`](./.env.example). The important
ones:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `JWT_SECRET` | **yes in production** | — | signs the session cookie; the server refuses to boot without it |
| `DATA_DIR` | no | `/data` | the persistent volume |
| `UPLOADS_DIR` | no | `${DATA_DIR}/uploads` | the file bucket |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | for mail | Gmail defaults | the SMTP server |
| `SMTP_USER` | for mail | `samirfayez03@gmail.com` | the sender account |
| `SMTP_PASS` | for mail | — | the Gmail **app password** |
| `TZ` | no | `Asia/Kuwait` | the timezone the daily job runs in |
| `MAX_UPLOAD_MB` | no | `25` | the upload size cap |
| `MAX_EMAIL_ATTACHMENT_MB` | no | `20` | the attachment cap, kept under Gmail's 25 MB ceiling |

The SMTP password is read from the environment **only**. It is never written to
the database and never returned by the API — the Settings screen only shows
whether SMTP is configured.

---

## First administrators

There is no built-in account and no default password. On the first start of an
empty database the server creates the administrators named in
`ADMIN_SEED_EMAILS` (comma-separated) with the password in
`ADMIN_SEED_PASSWORD` (at least 12 characters). Both live only in the
environment of the server. Without them no administrator is created and the
server logs a warning. The seed never overwrites an existing account.

---

## The API

The SPA talks to a small REST API. It serves the same envelope everywhere:

```json
{ "data": …, "error": null }
```

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Data | `GET/POST /api/{companies,ministries,document-types,positions,employees,documents}`, `GET/PATCH/DELETE /api/{resource}/:id` |
| Files | `POST /api/files/upload`, `GET /api/files/:documentId`, `…/download`, `…/preview`, `PUT/DELETE /api/documents/:id/file`, `…/employees/:id/photo` |
| Email | `GET /api/email/status`, `POST /api/email/test`, `GET /api/email/expiry-preview`, `POST /api/email/expiry-report`, `POST /api/email/send-documents`, `GET /api/email/log` |
| Scheduler | `GET /api/cron/status`, `PUT /api/cron/schedule` |
| Settings | `GET/PUT /api/settings` |
| Backup | `GET /api/backup/export`, `POST /api/backup/erase` |
| Health | `GET /api/health` |

List endpoints accept `select`, `eq[field]`, `neq[field]`, `gt[field]`,
`gte[field]`, `lt[field]`, `lte[field]`, `like[field]`, `in[field]`, `order`,
`limit` and `offset`.

`select` is a **relation-inclusion** directive, not a projection: a row always
comes back complete, with the requested relations embedded as nested objects.

A `PATCH` keeps the stored value for any key you omit, and clears the field when
you send an explicit `null`.

---

## Deployment

The full runbook — including how to mount the file bucket on the host — is in
**[docs/DOKPLOY.md](./docs/DOKPLOY.md)**.

In short:

```bash
# on the host
sudo mkdir -p /opt/romani/data/uploads
sudo chown -R 1001:1001 /opt/romani/data
sudo touch /opt/romani/data/.romani-volume
```

Then bind-mount `/opt/romani/data` → `/data` in Dokploy and set the environment
variables. The `.romani-volume` marker makes the server fail loudly instead of
silently writing into a container directory that disappears with the next deploy.

---

## Project layout

```
├── server/                  # the API
│   ├── db/                  # connection, migrations, seed
│   ├── middleware/          # auth, error envelope
│   ├── repositories/        # data access
│   ├── routes/              # HTTP endpoints
│   ├── services/            # storage, mail, cron, expiry, documents
│   └── templates/           # the HTML emails
├── src/
│   ├── lib/api/             # the typed API client
│   ├── components/          # UI components
│   ├── translations/        # en + ar translations
│   ├── pages/               # screens
│   └── types/               # shared types
├── docs/                    # SPEC.md, IMPLEMENTATION_PLAN.md, DOKPLOY.md
└── data/seed.json           # the reference data imported on first boot
```

No source file exceeds **500 lines**; `npm run check:sizes` enforces it. The
vendored shadcn primitives in `src/components/ui/` are the only exception — they
are generated and are not hand-edited.

---

## Security notes

- Passwords are hashed with bcrypt; the session is an HS256 JWT in an httpOnly,
  SameSite cookie.
- Login attempts are rate limited per IP.
- Every API route except login and the health check requires a session.
- Uploaded files are served only through authenticated endpoints — there is no
  static directory that publishes them.
- The resolved file path is verified to stay inside the bucket, so a stored path
  can never escape it.
- The SMTP password and the JWT secret live in the environment only.

---

## Licence

Proprietary software developed for the ROMANI organization.
