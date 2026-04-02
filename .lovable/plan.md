

# Frontend Redesign — Teal/Cyan Medical Color Palette

## Extracted Color Palette from Reference Image

The reference image uses a clean medical/health teal-cyan palette:

```text
Primary Teal:     HSL(175, 45%, 42%)  — #3BA99E (dominant buttons, headers)
Dark Teal:        HSL(178, 55%, 25%)  — #1C6B66 (sidebar, headings)
Light Ice Blue:   HSL(195, 45%, 92%)  — #D8EDF2 (backgrounds, cards)
Pale Cyan:        HSL(185, 35%, 96%)  — #EDF6F8 (subtle backgrounds)
Accent Mint:      HSL(165, 40%, 85%)  — #BDE8DD (badges, highlights)
White:            #FFFFFF             (card surfaces)
Dark Navy:        HSL(210, 50%, 15%)  — #132A3E (text)
```

## What Changes (Frontend Only)

### 1. CSS Variables (`src/index.css`)
- Replace the entire `:root` color system with the teal palette
- Replace the `.dark` theme with a complementary dark teal scheme
- Update gradients to use teal-to-cyan instead of indigo-to-purple
- Update shadow variables to use teal tints
- Remove the duplicate second `:root` block (lines 225-311) — consolidate into one clean block

### 2. Tailwind Config (`tailwind.config.ts`)
- No structural changes needed (it references CSS variables)
- Update font stack: add Inter for LTR alongside Tajawal/Cairo for Arabic

### 3. Login Page (`src/pages/Login.tsx`)
- Update gradient orbs to teal/cyan/mint instead of primary/medical/corporate
- Style the login card with a subtle teal border accent
- Update the icon container to teal gradient

### 4. Landing Page (`src/pages/Index.tsx`)
- Update feature cards to use glass-teal styling
- Update gradient backgrounds to teal palette
- Refine the hero section with cleaner spacing

### 5. Layout & Sidebar (`src/components/Layout.tsx`, `src/components/AppSidebar.tsx`)
- Update header: clean white with subtle teal bottom border
- Sidebar: dark teal background with white text (matches reference's professional look)
- Active nav item: mint/light-teal highlight with teal text
- Sidebar header: teal gradient brand area

### 6. Dashboard (`src/pages/Dashboard.tsx`)
- Stat cards: clean white cards with teal icon accents and subtle left-border color coding
- Remove the debug/force-refresh section (not professional)
- Quick action buttons: teal-outlined style
- Expiry table: teal header row, clean alternating rows

### 7. Employee Card (`src/components/EmployeeCard.tsx`)
- Avatar fallback: teal background with white text
- Document count badge: teal instead of blue
- Hover state: subtle teal shadow

### 8. Global Component Touches
- Buttons (`src/components/ui/button.tsx`): primary variant picks up new teal from CSS vars automatically
- Badges, status indicators: will inherit new palette from CSS vars
- No changes to data logic, API calls, database layer, or Edge Functions

## Files Modified
1. `src/index.css` — Full color system rewrite (consolidated, no duplicates)
2. `tailwind.config.ts` — Minor font update
3. `src/pages/Login.tsx` — Visual styling classes only
4. `src/pages/Index.tsx` — Visual styling classes only
5. `src/pages/Dashboard.tsx` — Card styling, remove debug section
6. `src/components/Layout.tsx` — Header styling
7. `src/components/AppSidebar.tsx` — Sidebar color scheme
8. `src/components/EmployeeCard.tsx` — Card accent colors

## What Does NOT Change
- All backend logic, Supabase queries, Edge Functions
- All translation files
- All routing, authentication, data flow
- Settings, Documents, EmployeeDocuments pages (they inherit new colors from CSS vars)
- Package dependencies

