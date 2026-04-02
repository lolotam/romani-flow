

# Full App Bug Audit & Refactoring Plan

## Bugs Found

### Bug 1: `handleAddEmployee` and `handleEditEmployee` are stubs
**File**: `src/pages/Employees.tsx` (lines 126-132)
Both functions only `console.log` — clicking "Add Employee" or "Edit Employee" does nothing. These need full implementations that call `jsonDatabase.insert('employees', ...)` and `jsonDatabase.update('employees', ...)`.

### Bug 2: `forceRefresh` clears ALL localStorage
**File**: `src/pages/Dashboard.tsx` (line 78)
`localStorage.clear()` wipes the entire JSON database (`romani_json_database`), email settings, pinned reminders — effectively erasing all user data. Should only clear cache-related keys, not the database.

### Bug 3: Quick actions use `window.location.href` instead of React Router
**File**: `src/pages/Dashboard.tsx` (lines 402-406)
Causes full page reloads instead of SPA navigation. Should use `navigate()` from `useNavigate`.

### Bug 4: Dark mode managed in two places
`Settings.tsx` manages dark mode via `localStorage.setItem('darkMode', ...)` and `document.documentElement.classList`, while `ThemeProvider` context likely manages it separately. This can cause state conflicts.

### Bug 5: Debug `console.log` statements left in production code
**File**: `src/pages/Dashboard.tsx` (lines 131, 172-176)
Debug logs like `console.log('🔄 Fetching fresh data...')` and `console.log('📈 DEBUG - Final counts:...')` should be removed.

### Bug 6: Duplicate interface definitions across files
`Document`, `Employee`, `Company`, `DocumentType`, `Ministry` interfaces are redefined locally in `Documents.tsx`, `Employees.tsx`, `EmployeeDocuments.tsx`, `EmployeeProfile.tsx`, and `Settings.tsx` — instead of importing from `jsonDatabase.ts` which already exports them.

### Bug 7: `AdminUser` type with `password_hash` in jsonDatabase.ts
**File**: `src/lib/jsonDatabase.ts` (lines 70-76)
Legacy type from the old hardcoded auth system. No longer needed since auth is now via Supabase.

---

## Refactoring Plan

### Phase 1: Fix Critical Bugs (immediate)

**1.1 — Fix `forceRefresh` to not destroy data**
- Change `localStorage.clear()` to only remove cache keys (pinned, deleted reminders) — NOT `romani_json_database`

**1.2 — Implement `handleAddEmployee` and `handleEditEmployee`**
- Wire up the add/edit dialog forms to actually call `jsonDatabase.insert` and `jsonDatabase.update`
- Add proper validation and toast feedback

**1.3 — Fix quick actions to use React Router navigation**
- Replace `window.location.href = '/...'` with `navigate('/...')`

### Phase 2: Code Quality Cleanup

**2.1 — Remove debug console.logs**
- Remove all debug/emoji console.log statements from Dashboard.tsx

**2.2 — Centralize shared interfaces**
- Create `src/types/index.ts` exporting all shared interfaces (re-export from `jsonDatabase.ts`)
- Update Documents.tsx, Employees.tsx, EmployeeDocuments.tsx, EmployeeProfile.tsx to import from central types
- Remove duplicate local interface definitions

**2.3 — Remove legacy `AdminUser` type**
- Remove from `jsonDatabase.ts` and the `admin_users` table from the Database interface

**2.4 — Fix dark mode conflict**
- Remove manual dark mode toggle from Settings.tsx
- Ensure AppearanceSettings uses the ThemeProvider context exclusively

### Phase 3: Large File Splitting

**3.1 — Split Dashboard.tsx (732 lines)**
- Extract `DashboardStats` cards → `src/components/dashboard/StatsGrid.tsx`
- Extract reminders table → `src/components/dashboard/RemindersTable.tsx`
- Extract recent activities → `src/components/dashboard/RecentActivities.tsx`
- Extract quick actions → `src/components/dashboard/QuickActions.tsx`

**3.2 — Split Employees.tsx (1200 lines)**
- Extract add/edit employee form → `src/components/employees/EmployeeForm.tsx`
- Extract employee table → `src/components/employees/EmployeeTable.tsx`
- Extract view employee dialog → `src/components/employees/EmployeeViewDialog.tsx`

**3.3 — Split Documents.tsx (1032 lines)**
- Extract document card grid → `src/components/documents/DocumentGrid.tsx`
- Extract view document dialog → `src/components/documents/DocumentViewDialog.tsx`
- Extract employee section → `src/components/documents/EmployeeSection.tsx`

**3.4 — Split EmployeeDocuments.tsx (997 lines)**
- Extract document list/grid → `src/components/documents/EmployeeDocList.tsx`
- Extract upload dialog → `src/components/documents/UploadDialog.tsx`

---

## Implementation Order
1. Fix `forceRefresh` data destruction bug (critical)
2. Implement employee add/edit stubs (critical)
3. Fix quick action navigation
4. Remove debug logs
5. Centralize interfaces into `src/types/index.ts`
6. Remove AdminUser legacy type
7. Split Dashboard.tsx into components
8. Split Employees.tsx into components
9. Split Documents.tsx into components
10. Split EmployeeDocuments.tsx into components

## Files Modified/Created
- `src/pages/Dashboard.tsx` — Bug fixes + split into components
- `src/pages/Employees.tsx` — Implement stubs + split
- `src/pages/Documents.tsx` — Split into components
- `src/pages/EmployeeDocuments.tsx` — Split into components
- `src/types/index.ts` — NEW shared types
- `src/components/dashboard/StatsGrid.tsx` — NEW
- `src/components/dashboard/RemindersTable.tsx` — NEW
- `src/components/dashboard/RecentActivities.tsx` — NEW
- `src/components/dashboard/QuickActions.tsx` — NEW
- `src/components/employees/EmployeeForm.tsx` — NEW
- `src/components/employees/EmployeeTable.tsx` — NEW
- `src/components/employees/EmployeeViewDialog.tsx` — NEW
- `src/components/documents/DocumentGrid.tsx` — NEW
- `src/components/documents/DocumentViewDialog.tsx` — NEW
- `src/lib/jsonDatabase.ts` — Remove AdminUser

