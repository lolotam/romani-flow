

# Plan: Fix Build Errors, Replace Auth, and Split Settings

## Overview
Three tasks: (1) fix duplicate property build errors in translation files, (2) replace hardcoded admin credentials with Supabase Auth, (3) split the 1777-line Settings.tsx into smaller components.

---

## Task 1: Fix Translation File Duplicate Properties

**Problem**: Both `ar.ts` and `en.ts` have duplicate property names within the same object literals (TS1117 errors at ~16 locations total).

**Approach**: Rewrite both translation files completely, preserving all translation content but ensuring every property name is unique within its parent object. The structure will remain identical (same keys used by `t()` calls throughout the app), just with duplicates removed.

**Files modified**:
- `src/translations/ar.ts` — full rewrite, ~853 lines
- `src/translations/en.ts` — full rewrite, ~869 lines

---

## Task 2: Replace Hardcoded Auth with Supabase Auth

**Current state**: `useAuth.tsx` has hardcoded `admin` / `@Xx123456789xX@` credentials stored in plaintext, with a localStorage token for session persistence.

**New approach**: Use Supabase Auth (`supabase.auth.signInWithPassword`, `signOut`, `onAuthStateChange`, `getSession`).

**Files modified**:
- `src/hooks/useAuth.tsx` — Replace with Supabase Auth calls:
  - `login()` calls `supabase.auth.signInWithPassword({ email, password })`
  - `logout()` calls `supabase.auth.signOut()`
  - `useEffect` sets up `onAuthStateChange` listener (set up BEFORE calling `getSession`)
  - Export `user` and `session` from context
- `src/pages/Login.tsx` — Change "username" field to "email" field, update form labels
- `src/components/ProtectedRoute.tsx` — No changes needed (already uses `isAuthenticated` / `isLoading`)

**Migration note**: The existing admin user needs to be created in Supabase Auth (via dashboard or signup). No profiles table needed since this is a single-admin system.

---

## Task 3: Split Settings.tsx into Components

**Current state**: `Settings.tsx` is 1777 lines with 7 tab sections, all CRUD logic, and all edit dialogs in one file.

**New structure**:

```text
src/components/settings/
├── EmailSettings.tsx        (~250 lines) — SMTP config + expiry monitoring
├── AppearanceSettings.tsx   (~50 lines)  — Dark mode toggle
├── CompaniesSettings.tsx    (~150 lines) — Company CRUD + edit dialog
├── PositionsSettings.tsx    (~150 lines) — Position CRUD + edit dialog
├── DocumentTypesSettings.tsx(~150 lines) — Doc type CRUD + edit dialog
├── MinistriesSettings.tsx   (~150 lines) — Ministry CRUD + edit dialog
├── BackupSettings.tsx       (~150 lines) — Export/import/erase
└── types.ts                 (~30 lines)  — Shared interfaces
```

**Settings.tsx** becomes a thin orchestrator (~200 lines):
- Keeps top-level state (`companies`, `documentTypes`, etc.)
- Keeps `fetchData()` function
- Passes state and handlers as props to each tab component
- Renders the `Tabs` layout with each `TabsContent` delegating to the sub-component

**Shared interfaces** (`types.ts`): `EmailSettings`, `Company`, `DocumentType`, `Ministry`, `Position` interfaces extracted from Settings.tsx lines 45-81.

---

## Implementation Order
1. Fix translation duplicates (unblocks build)
2. Replace auth with Supabase Auth
3. Split Settings.tsx into components

## Technical Notes
- The `login` function signature changes from `(username, password)` to `(email, password)` — Login.tsx form already has an email-style input
- Hardcoded SMTP credentials on lines 101-106 of Settings.tsx will remain as env var fallbacks for now (separate security concern, not blocking)
- All `t()` translation keys remain unchanged, so no other files need updating for translations

