# Replace the browser database with a self-hosted SQLite backend

## Why

The application had no real database:

- **Storage** lived in the browser (`localStorage`, key `romani_json_database`) — every browser had its own copy, the ~5 MB quota was easy to hit, and files were either base64 blobs in a row or paths that pointed nowhere.
- **Auth** on `main` was wired to a Supabase project that **no longer exists** (`xwgdkbulehhtrjjoglkb.supabase.co` returns NXDOMAIN from every public resolver), so login was broken.
- **Migrations** targeted that dead project, and two of them were byte-identical, so a fresh apply failed on "table already exists".
- **Email** called a Supabase Edge Function on the same dead project — no SMTP, no attachments, no scheduling.

This branch replaces all of it with a Node API that owns its own SQLite database and its own file bucket.

## What changed

### New: the API server (`server/`)

| Area | Notes |
|---|---|
| **Database** | SQLite through the built-in `node:sqlite` — no native compilation, so the Docker image needs no toolchain. WAL, foreign keys, `busy_timeout`. |
| **Migrations** | `server/db/migrations/*.sql`, applied in order and recorded in `schema_migrations`. |
| **Seed** | `data/seed.json` (the full 20-employee dataset). Guarded by a permanent `system.seed_version` marker, so **deleting data never brings it back**. |
| **Auth** | Email + password, bcryptjs, a JWT in an httpOnly cookie, per-IP login rate limiting. Two seeded admins. |
| **Files** | A staged-upload contract (`upload_id`) — a client never writes a storage path. `DocumentService` owns the file lifecycle. |
| **Mail** | Nodemailer over SMTP. The password lives in the environment only, never in the database. |
| **Scheduler** | node-cron inside the API process, re-armed whenever the settings change, with an overlap guard and a retryable failure path. |
| **Reminders** | Five thresholds (3 months / 1 month / 15 days / 1 week / 1 day), each switchable on its own, deduplicated per item and threshold. |
| **Email body** | Arabic, right-to-left, in the teal palette of the app, with every document detail. `email.language` switches it to English. |

### New: the deployment

- A **multi-stage Dockerfile** (`node:24-alpine`) that builds the SPA and the server and serves both from one process — the nginx layer is gone.
- **One volume** holds everything that must survive a redeploy: the SQLite database and the file bucket.
- A **host-prepared `.romani-volume` marker**: production boot refuses to start without it, so a missing mount can never silently discard the database.
- **[`docs/DOKPLOY.md`](docs/DOKPLOY.md)** — the full runbook: host preparation, the bind mount, the environment variables, the Gmail app password, backup and restore, troubleshooting.

### Changed: the SPA

- `src/lib/api/**` replaces `src/lib/jsonDatabase.ts` with the **same fluent surface** (`from().select().eq()…`), so the pages changed very little.
- `useAuth` now talks to the API; the hardcoded credential check is gone.
- The two broken upload paths are gone: one stored base64 in a row, the other stored a path to a file that was never written.
- Settings gained the reminder intervals, the recipient lists, the scheduler panel, the SMTP status and the send log.
- The i18n files were split by domain, and the two duplicate-key bugs the build reported are fixed.

### Removed

`src/lib/jsonDatabase.ts`, `src/integrations/supabase/`, `supabase/`, `public/data/database.json`, `nginx.conf`, the two scripts that carried a committed Supabase key, and a 16 MB binary that was committed to the repository.

## Verification

`scripts/verify-api.mjs` asserts the behaviour that is easy to break silently — **46 assertions, all passing**:

```
node scripts/verify-api.mjs http://127.0.0.1:3199
```

It covers the authentication boundary, the relation embedding, every filter operator, the derived status, the PATCH clearing semantics, the rejection of forged storage columns, the staged-upload flow end to end, the settings guards and the backup export.

The seed fix was proven directly: after `POST /api/backup/erase` and a restart, `employees` and `documents` are still empty.

## Notes for the reviewer

- The base is `origin/main`, so this branch also contains the Settings/Dashboard splits, the centralised types and the teal redesign that were already on `main`.
- The old branch-local change to `src/pages/Settings.tsx` was stashed, not lost — it was superseded by the rewrite of that file.
- `docs/SPEC.md` and `docs/IMPLEMENTATION_PLAN.md` carry the design and the revision log from the Codex review rounds.
