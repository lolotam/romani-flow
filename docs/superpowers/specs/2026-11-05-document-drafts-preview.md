# Document drafts and in-form preview ? owner review packet

Status: owner approved this design with GO; implementation is local and production release remains separately gated. Owner selected the last UNSAVED draft, not last successful submission. Existing independent PR13 remains separate.

## Proposed behavior
- Both DocumentForm and EmployeeDocumentForm autosave the current field values to the authenticated administrator account, restoring across devices as previously requested for persistence. Save status and read/write failures are visible in Arabic/English. Restore never overwrites edits made while loading.
- Keep distinct drafts for general new-document forms, each fixed employee/company context, and each edited existing document. A draft cannot replace fixed employee/company identity. Draft restoration must validate referenced catalog IDs and serialize dates as date-only values.
- Dates belong to this unfinished draft only. Successful creation/update clears that exact saved revision; a later new document never inherits prior issue/expiry dates. Last-successful defaults remain a fallback only when no draft exists and never supply dates. A discard action removes only this account/context draft.
- Persist metadata only. Local File/blob contents are NOT silently uploaded or saved in the draft. If the page is refreshed or resumed on another device, show a clear reattach-file notice. A file remains available while the form stays open. No file staging before the user presses Save in this bounded implementation.
- Autosave uses bounded/debounced writes, context/account guards and optimistic revision checks. Close flushes the current draft; successful save/discard stops late writes so a deleted draft cannot reappear. Concurrent-device conflict must be shown, not silently overwrite newer data.
- Add a narrow account-owned draft API with admin-only mutations/no-store, field/size validation and server-derived account identity. Use a separate additive migration at the next verified available number for a draft table; do not store unsaved drafts as successful-submission defaults. Production migration/deployment is separately gated.

## Preview
- Show a useful PDF viewer or contained image alongside editable fields on desktop; stack the preview and fields on small screens. Cover both form entry points and existing attachments when editing.
- Uploaded PDF/JPEG/PNG uses a transient local object URL. Revoke on replacement/unmount, never show the old file under a new selection, and do not leak bytes to an external viewer/service. Existing saved files use the authenticated same-origin preview route.
- Keep current allowed upload formats and limits; previews do not add SVG/HTML, bypass authorization, or create uploads. Use accessible AR/EN preview/unavailable/reattach labels and RTL layout. Native PDF preview availability depends on the browser; provide an explicit local open link if embedding is unavailable.

## Verification and release
Use isolated API/SQLite tests for ownership, revisions, date round trips, restore/dirty races, clear-on-success and concurrent conflicts. Verify actual preview component output/lifecycle with suitable UI evidence; do not claim SSR proves browser PDF rendering. Preserve staging/retry/document transaction assertions. Run relevant tests/typecheck/build/lint and publish a separate PR. No production data fabrication, deployment, migration, WhatsApp send or AI/OCR work is included in this feature batch.

