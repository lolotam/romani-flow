# Document drafts and in-form preview

Administrators automatically retain unfinished document metadata on their account, independently for general creation, each fixed employee/company and each existing-document edit. Resume on another device with the same account. A successful document save clears the exact draft revision inside the same transaction as the document write/upload claim. Completed document issue/expiry dates never become defaults for the next new document.

Drafts contain fields only, not attachments or staged-upload IDs. Choose the file again after refreshing/changing devices; the form displays a reattach notice. While the form remains open, PDF/JPEG/PNG preview uses a transient local URL with cleanup. Existing attachments use the authenticated same-origin file route. No external viewer receives file bytes. PDF display depends on the browser; the form offers a local/same-origin open link.

## Editing and conflicts

Writes debounce for500 ms and the form shows loading/saving/saved/error state. Normal modal close awaits the current save. Requests use keepalive for bounded metadata writes; abrupt browser/process termination cannot guarantee delivery of an unfinished request. Check the saved status before leaving.

Another device changing the same draft causes a conflict instead of silently overwriting. Reopen the form to read the newer version. Late reads cannot replace typed input. Discard affects only this account/context. Tombstone revisions prevent old writes from recreating a discarded/saved draft. No automatic retry follows uncertain write errors.

## API and release

Admin-only, no-store endpoints: GET/PUT/DELETE /api/document-drafts/:scope. Supported scopes: new, employee:<id>, company:<id>, edit:<id>. Account comes from the authenticated session; x-draft-account must match it to reject requests from an old browser identity. PUT accepts revision/values; DELETE accepts revision. Values are field-allowlisted, at most16 KiB, with bounded strings/date-only dates and validated references. Writes serialize with document mutations/business erase.

Migration 008_document_drafts.sql is additive and must pass the production release/migration gate before deployment. It adds account-owned metadata/revisions and invalidates related drafts on employee/company/document deletion. Business erase clears private draft values and rotates revisions. Full SQLite recovery backups contain these private drafts; business JSON exports do not. Preserve existing private backup permissions. Image rollback should retain the additive table/triggers; never replace the production DB or drop the table merely to roll back this feature.

No WhatsApp/email activation, sending, environment change or production migration is performed by this implementation. File staging remains at document Save. Verification uses isolated SQLite/API, synthetic files, real client state machine and actual component SSR; SSR does not prove native browser PDF rendering.

Closing after a draft failure/conflict offers an explicit confirmation before discarding unsaved local changes; the last server draft remains. A failed document-save CAS keeps prepared metadata and exposes the conflict. Concurrent discard clicks share one operation. Business erase also rotates an epoch for never-written scopes, so an old first-write reference is rejected. Custom entity names are limited to 100 characters consistently in the input, form schema and draft API.
