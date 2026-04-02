

# Fix Preview Build — Translation Duplicate Properties

## Diagnosis

After thoroughly reviewing the entire codebase, the source files appear syntactically correct. However, the TS1117 "duplicate property" errors reported earlier may still be cached or the translation files may have invisible issues (e.g., duplicate keys that the search didn't catch due to nesting).

The most reliable fix is to **do a clean rewrite of both translation files** to guarantee zero duplicates, plus verify the build compiles successfully.

## Plan

### Step 1: Verify Build by Checking Dev Server Log
Run `tail -n 200 /tmp/dev-server-logs/dev-server.log` and `grep -nE 'error|TS1117|failed' /tmp/dev-server-logs/dev-server.log` to see the actual current errors.

### Step 2: Clean Rewrite of Translation Files (if errors persist)
If the TS1117 errors are still present:
- **`src/translations/en.ts`** — Full rewrite preserving all ~869 lines of content, ensuring no duplicate keys exist at any nesting level
- **`src/translations/ar.ts`** — Full rewrite preserving all ~853 lines of content, same treatment

The rewrite will maintain the exact same structure and keys used throughout the app. Only duplicate property definitions will be removed (keeping the last/most complete value for each duplicate).

### Step 3: Add Missing Translation Key
Add `noPreview` to `documents.card` in both translation files:
- `en.ts`: `noPreview: 'No Preview'`
- `ar.ts`: `noPreview: 'لا توجد معاينة'`

### Step 4: Verify Build Passes
Run `npx vite build` to confirm zero TypeScript errors.

## Files Modified
- `src/translations/en.ts`
- `src/translations/ar.ts`

## Technical Notes
- The code in all other files (Settings components, useAuth, Documents, EmployeeDocuments, etc.) has been reviewed and is syntactically correct
- The Supabase client is correctly configured
- All component imports and exports are valid
- The build issue is isolated to the translation files

