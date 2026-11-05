# Per-channel Notification Language Implementation Plan

Owner selected independent languages per channel and approved the proposed design. Implement directly in this existing session; no delegation or paid review.

**Goal:** Independently select Arabic or English for actual WhatsApp reminder content and existing email reports, with synthetic previews from the real server renderers.

- [x] Add a validated whatsapp.language settings key/default without migration; localize WhatsApp messages and residency label. Preserve canonical identities and accepted/unknown suppression.
- [x] Add an admin-only read-only synthetic template preview endpoint using actual WhatsApp/email renderers; no provider/mail calls or customer records.
- [x] Reuse guarded settings load/mutation for WhatsApp language. Add a small shared language selector/preview component to both settings cards; abort stale preview requests and hide old data on failures.
- [x] Cover independent persistence, invalid-value atomic denial/viewer denial, actual templates, pending reconciliation and immutable attempts/suppression with isolated API/SQLite tests.
- [x] Run appropriate tests, typecheck/build/lint, test-guard and clean-code-guard; publish separate PR with exact evidence. Merge/deploy/live activation remain separate.

Live two-recipient test remains authorized but blocked by unavailable ssh-curemed-mcp. Do not drain scheduled backlog or enable global reminders to perform it.
