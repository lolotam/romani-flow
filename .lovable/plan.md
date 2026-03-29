

# Fix Build Error + Refactoring Plan

## Problem
`Settings.tsx` has a missing `useEffect` wrapper around lines 125-143. The code calls `fetchData()` and sets state directly in the component body instead of inside a `useEffect`. This causes the build error `Unexpected ","` at line 143 where `}, []);` appears without a matching `useEffect(() => {`.

## Fix (Step 1) — Restore missing useEffect

**File**: `src/pages/Settings.tsx`

Add `useEffect(() => {` between line 125 and 126:

```tsx
// Line 123: const { toast } = useToast();
// Line 124: (blank)
// INSERT THIS:
  useEffect(() => {
    fetchData();
    // Check for dark mode preference
    const isDark = localStorage.getItem('darkMode') === 'true';
    // ... rest stays the same through line 143
```

This single line addition fixes the build error — the closing `}, []);` on line 143 will then have a matching opening.

---

## Refactoring Plan (Step 2) — Code Quality Improvements

After fixing the build error, the codebase has several areas to improve:

### 2.1 Split Settings.tsx (1777 lines — too large)
- Extract into smaller components: `EmailSettings`, `ThemeSettings`, `DataManagement`, `ExpiryReminders`
- Each section becomes its own file under `src/components/settings/`

### 2.2 Replace Hardcoded Auth with Supabase Auth
- Current `useAuth.tsx` uses hardcoded credentials (`admin` / `@Xx123456789xX@`) with localStorage token
- Migrate to Supabase Auth for proper security
- Remove plaintext credentials from source code

### 2.3 Remove Exposed SMTP Credentials
- `Settings.tsx` lines 101-106 contain hardcoded SMTP passwords and email addresses
- Move to environment variables or Supabase secrets

### 2.4 Consolidate Database Layer
- `jsonDatabase` and Supabase client coexist — clarify which is the source of truth
- Remove unused database abstraction if Supabase is primary

### 2.5 Extract Reusable Hooks
- Create `useDocumentStatus` hook from repeated status calculation logic
- Create `useEmployeeDocuments` hook for document fetching patterns used across pages

---

## Implementation Order
1. Fix the `useEffect` build error (immediate)
2. Remove hardcoded credentials (security priority)
3. Split Settings.tsx into components
4. Consolidate database layer
5. Extract reusable hooks

