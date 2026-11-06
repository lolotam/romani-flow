# Document Drafts and Preview Implementation Plan

**Goal:** Account/context-owned unsaved document metadata across devices, plus local PDF/image preview while filling either document form.

Implement directly in the existing session; no delegation, paid service or production action.

- [x] Add migration008_document_drafts with CAS revisions/tombstones, private account ownership and reference-deletion invalidation. Add bounded validated draft repository/router; erase invalidates all drafts.
- [x] Accept a draft revision reference on document creation/update, remove it before the business write and clear the exact draft inside the existing transaction; stale revision rolls back the write/upload claim.
- [x] Add a serialized client session and hook: debounced save, late-read/account/context guards, close flush, optimistic conflict, discard and suspend/commit lifecycle. Connect both forms without inheriting completed-document dates.
- [x] Render local PDF/JPEG/PNG previews and authenticated existing attachments, with URL cleanup and responsive layout; no pre-save staging or external viewer.
- [x] Test real isolated API/SQLite ownership/CAS/rollback/clear, client lifecycle and preview behavior. Run typecheck/build/lint and required guards; prepare separate PR for publication, preserving owner AGENTS.md and supabase.
