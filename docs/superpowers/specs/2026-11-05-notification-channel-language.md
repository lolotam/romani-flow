# Per-channel notification language and template previews

Status: owner selected one language per channel and approved the design through the quoted implementation recommendation. Local implementation only; no production configuration or sends.

## Existing behavior
Email already supports email.language (ar/en) in its report rendering and an English switch in Settings. WhatsApp reminderText currently renders fixed Arabic messages. Preserve the existing grouped management email report, reminder schedule, eligibility, opt-ins, canonical destination identity and accepted/unknown suppression.

## Proposed bounded design
- Two channel template sections: WhatsApp reminder and Email expiry report. Each has an explicit Arabic/English selector and a synthetic preview in that language, independent of UI language and the other channel.
- Reuse email.language. Add whatsapp.language as an allowlisted ar/en settings value, default ar if absent, without schema migration. The admin-only settings write path remains authoritative.
- Fixed bilingual templates in this iteration, not arbitrary HTML/text editing. Existing employee-specific WhatsApp greeting remains distinct from the management/company wording. Preserve stored document and person names without automatic translation.
- WhatsApp English management example: Reminder: document ?Work permit? for employee ?Example employee? expires on 05/11/2026. Please follow up on renewal. Company version labels the owner as a company.
- WhatsApp English employee example: Hello ?Example employee?, reminder: document ?Work permit? expires on 05/11/2026. Please follow up with management on renewal.
- Preserve owner-approved Arabic wording. English residency label is Residency. Email preview uses existing report sections with localized subject, headings, statuses and dates; Arabic HTML uses RTL and English LTR, with escaped data.
- A language change can update only never-handed-off eligible reminder snapshots under the existing coordinator. It never recreates accepted/unknown identities, retries an uncertain send, or changes audit attempt text/history.
- Read/load errors do not invent a language value and must not overwrite settings with defaults. Save errors stay visible; controls use existing admin identity and busy guards.

## Acceptance and tests
Persist/reload independent channel choices; reject unsupported languages atomically; prove actual selection/text/subject/HTML language; preserve pending-vs-accepted/unknown semantics; verify viewer mutation denial; retain RTL, consent and existing scheduling tests. Run typecheck/build/lint and focused notification/API suites on the implementation head. Publish a separate reviewed PR; no deployment implied.

## Authorized live test and present blocker
Owner authorized a WhatsApp test to the two newly stored receivers. Verify fixed romani state=open, enumerate exactly two enabled management destinations without printing their full numbers, and perform one clearly labeled test per distinct canonical number. Persist sanitized outcomes, never equate provider acceptance with delivery, and never retry unknown outcomes. Do not enable the global scheduler or drain business backlog for this test. No email test has been requested in this turn.

Current ssh-curemed-mcp list_connections returns: The connector is unavailable, changed, disabled, or requires authentication. Inspect the hub and refresh tools. No recipient read, provider call or message send was performed. Do not invent an alternate instance or consume the private handoff file.
