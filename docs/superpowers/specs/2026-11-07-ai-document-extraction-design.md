# AI document extraction with administrator review

Status: approved by Waleed on 2026-11-07 with “تم أكمل الخطة”. Implementation-plan drafting is authorized. Implementation and production activation have not occurred.

Manager review: accepted the complete specification on 2026-11-07 at SHA-256 `9c6510e5e87b35ee59f80d50e7bdb74ed6992b847e11106d0b33790f31b00a2c`, baseline `a25da0e2adca8b7a41b6a906353884d4dcfb54f8`. Subsequent edits here record approval and lane status only; acceptance requirements are unchanged.

Coordination update: Waleed subsequently delegated routine technical specification, plan, and continuation approval to the project manager in existing parent thread `5e5ac1cf-6bba-422f-857b-7eb32f8c8e83`. The owning session sends concrete artifacts, baseline SHA, blockers, and results to that manager and awaits technical disposition before implementation. Do not ask Waleed to navigate sessions or repeat routine approvals. The terminal state remains local commits only; no production migration or activation is authorized.

## Outcome

Selecting a PDF, JPEG/JPG, or PNG in either document form can extract supported metadata into empty editable fields. An administrator reviews the attachment and proposed values, edits them, and explicitly saves the document through the existing save transaction. Extraction never creates a final document or silently replaces administrator input.

The feature includes provider/model selection for Groq and OpenRouter, an optional document-number field, and local verification. It ships disabled. Real employee/company documents must not be sent externally during this task. Production credentials, activation, migration, push, merge, deployment, notifications, and cleanup are outside the authorized terminal state.

## Approved run configuration

| Responsibility | Selection and evidence |
| --- | --- |
| Profile | `postora-default`, with the plan-author override below |
| Plan | Codex astra 6 high: `gpt-6-astra`, high reasoning; T3 dispatch completed on 2026-11-07 with an 18-task plan; parent reviewed the artifact and clarified local dependency setup and red-test commit gates before manager review |
| Debate | None, explicitly selected through the profile |
| Implementation | Cursor Grok 4.7 medium; CLI lists `grok-4.7-medium`; T3 represents the same selection as provider `cursor`, model `grok-4.7`, `reasoning_effort=medium` |
| Execution | Subagent-driven, all implementation slices use the selected implementation model; separate child worktrees are managed by the delegation tool, with integration in this existing worktree |
| Tests | Antigravity Gemini 3.8 high: `gemini-3.8-flash-high`, confirmed in both provider catalog and `agy models`; not invoked yet |
| SQL | Orchestrator, explicitly approved by Waleed after `opencode/muse-spark-1.3-contributor-free` was absent from the current catalog; no paid substitute |
| Review | Orchestrator runs `requesting-code-review` and required artifact guards; no plan debate |
| Research | Current official provider documentation, explicitly requested for this task |
| Worktree | Existing authorized `feat/ai-document-extraction` worktree |
| Baseline | Initial PR14: `a25da0e2adca8b7a41b6a906353884d4dcfb54f8`; manager-approved integration baseline: `60f8be79af0c510d44792074055dde3e75851f80` (PR15), fast-forwarded locally with specification preserved |
| Terminal state | Reviewed local commits only, no push, PR, merge, or deployment |

Runtime model availability and quota must be checked only when dispatching that lane. A catalog entry is not proof of a successful inference. Do not silently change a provider/model if a lane fails; report the failure and obtain any newly required selection.

## Existing source boundaries

- `src/components/DocumentForm.tsx` and `src/components/EmployeeDocumentForm.tsx` own distinct form entry points, draft restoration, and explicit saves.
- `src/components/documents/useStagedDocumentUpload.ts` stages the persistent attachment during Save and supports retries. Extraction must not repurpose staging to upload a persistent attachment before Save.
- `src/components/documents/saveDocument.ts` builds the general form's final metadata payload. Employee-document save has its own path and requires equivalent coverage.
- `src/lib/documentFormDrafts.ts`, `src/lib/documentDraftSession.ts`, and `server/repositories/documentDrafts.ts` implement scoped account-owned metadata drafts. Extend their field handling without weakening revision/identity checks.
- `server/routes/settings.ts` validates an explicit editable-key allowlist. `server/repositories/settings.ts` stores typed non-secret settings. Use these boundaries for provider/model preferences.
- `server/config.ts` owns environment configuration. Provider keys belong here, never in settings rows, form drafts, frontend bundles, browser storage, logs, or API responses.
- `server/db/migrator.ts` applies ordered migrations transactionally. `server/index.ts` runs them at startup, so a future production rollout requires its own migration/release gate.
- The base schema's `documents` table has no document-number column. The latest migration in this worktree is `008_document_drafts.sql`.

The separate `fix/document-dialog-mobile` branch remains independently owned. Do not modify that branch or worktree. The manager confirmed PR15 merged and cleared the integration gate at `60f8be79af0c510d44792074055dde3e75851f80`; this worktree was fast-forwarded to that exact commit without resetting or replacing unique work. Preserve its responsive classes and added layout verification in later form changes. The manager accepted the mobile owner's deployment evidence; this session did not rerun production checks, and authenticated production modal behavior was not verified by that release packet.

## User workflow

1. With extraction disabled or unconfigured, file selection, preview, drafts, manual input, and Save continue to work normally.
2. When the feature is explicitly enabled for an approved provider and processing context, selecting a supported attachment starts a bounded extraction request after the form/draft is ready. The administrator sees processing status and can keep editing.
3. The result is applied only to eligible empty fields. A visible review notice identifies the values as machine suggestions. Unapplied or uncertain candidates remain available for review while that attachment is selected.
4. Editing, removing, or replacing the attachment, changing account/form context, discarding a draft, or closing the form invalidates the request. Responses from an obsolete selection cannot affect the current form.
5. Save is a separate administrator action. Extraction does not trigger Save, create a document, update an employee/company, or claim a persistent upload.
6. A failed extraction leaves manual entry available. An explicit retry can be offered after a rate-limit cooldown; retries never switch providers or models automatically.

Existing required-field and date-order validation still applies on Save. In particular, a missing or uncertain expiry date can remain empty for review, but must be supplied manually where the existing form requires it. An absent document number never prevents Save.

## Document number

- Add nullable, optional `document_number` to document persistence, API types/validation, both form paths, draft serialization/restoration, and edit/save round trips.
- Treat it as a string, maximum 128 characters after trimming surrounding whitespace. Preserve leading zeroes, letters, internal separators, and the source digit representation; never coerce to a number.
- An empty entry is stored as `NULL`. No generated fallback, employee civil ID substitution, required constraint, uniqueness constraint, or backfill is permitted.
- A number missing from an attachment remains empty. If several competing numbers exist and the document number cannot be distinguished, return it as uncertain rather than picking one.
- New-document defaults and last-successful-submission restoration must never carry the previous document's number into a new record. A scoped unfinished draft may restore its own number; an existing document edit may restore the stored number.
- General and employee document reads, exports, and final saves must preserve the field where their current contracts include document metadata.

Use one new additive migration at the next available version, currently `009`. Recheck numbering before writing it. Test upgrade from the existing schema, existing rows remaining valid with `NULL`, new/edit round trips, and repeat startup/migration execution on an isolated local database. Do not execute against production or any shared database. Retain the original eight migrations unchanged.

## Extraction contract

### Permitted fields

The response can propose document type, document number, issue date, expiry date, ministry, and a concise title where the receiving form supports it. It cannot update beneficiary type, employee/company IDs, employee identity fields, file paths, ownership, status, credentials, or arbitrary database fields. Notes remain administrator-authored.

Catalog matching uses existing document-type and ministry entries only. Accept only an unambiguous match from the current server-side catalog; an unknown or conflicting label remains a review suggestion. Extraction does not insert a new ministry/type or invoke the existing manual custom-entity creation flow. Each form retains its current supported ministry/save semantics.

### Uncertainty and normalization

- Validate provider output against a strict schema on the server. Treat all model output and document text as untrusted input, never as instructions or executable content.
- Dates are Gregorian date-only strings, `YYYY-MM-DD`, after calendar validation. Do not use today's date, infer missing components, choose between ambiguous day/month interpretations, or silently convert an uncertain calendar.
- Missing, unreadable, internally inconsistent, or conflicting values remain empty/reviewable. Contradictory pages do not produce an automatic final value.
- Confidence labels describe model suggestions, not measured statistical confidence. No claim of extraction accuracy is made without an actual evaluation.
- The server returns only the permitted normalized candidates and bounded review metadata. It never forwards arbitrary provider objects/errors directly to the browser.

### Application rules

Automatic application requires an empty field that has not been manually edited since the current form session began and has not changed since the request started. A deliberate manual clear remains protected. Stored values and restored draft values are protected. Filename-derived titles remain intact unless the administrator explicitly chooses a suggested title.

Track provenance for values filled by the current attachment. On replacement/removal, clear only those machine-filled values that remain unchanged by the administrator; preserve manual edits and pre-existing values. Recompute or invalidate candidates on catalog/context changes. Never let a later response, retry, draft restore, or previous attachment overwrite newer input.

Applied suggestions enter the existing metadata-draft workflow, visibly remaining unfinished. Raw OCR text, provider responses, confidence objects, image bytes, and API keys are not persisted in drafts. No final record is created until Save.

## File preparation and request limits

Use local PDF-to-image preparation and the same image-input contract for both providers. Bundle the selected renderer with the application; no third-party viewer, public upload URL, runtime CDN, or paid OCR service is allowed. The implementation plan selects and verifies the renderer dependency and its browser/build requirements against official documentation before adding it.

The bounded first release processes one selected document at a time, up to 10 PDF pages, with prepared images capped at 4 megapixels each and 10 MiB combined encoded request body. The source file must also pass the application's existing upload limit. These are product safety limits, not a claim about provider capacity.

Process all pages within the limit, batching to each selected model's documented image capacity. Do not silently truncate a longer PDF. Encrypted/unreadable PDFs, unsupported types, excessive page/image size, or preparation failure produce an actionable notice and preserve manual entry. A failed batch does not silently yield a supposedly complete result.

The extraction endpoint accepts only bounded supported image payloads and validates actual signatures/decoded dimensions, count, and total size. It does not accept arbitrary URLs, filesystem paths, or client-supplied provider endpoints. Provider requests use fixed official HTTPS hosts, bounded outputs, an overall timeout, bounded concurrency, and no unlimited retry loop. Cancellation stops local work and ignores late results; it cannot promise that an already transmitted provider request is undone.

Extraction image bytes are transient and separate from attachment storage. Do not register them as pending uploads or persist them in the application's file bucket. Avoid logging filenames, document contents, extracted identifiers, images, or provider payloads. Diagnostics use sanitized error categories and request IDs.

## Provider/model settings and cost enforcement

Provide an administrator-only settings section with enabled state, provider selection (`Groq` or `OpenRouter`), model selection, and a masked configured/not-configured key status. No key editing or key retrieval is exposed through this settings UI. Defaults are disabled, no selected provider, and no selected model; implementation must not silently activate a research recommendation.

Only the explicitly selected provider/model receives a request. Validate the selection on the server and reject an unsupported, removed, unapproved, or ineligible model. A model selector is not unrestricted arbitrary-model text entry. Model refresh/list failures preserve manual entry and never substitute a model.

- **Groq:** limit extraction to an explicitly approved vision model offered under the account's free allowance. Do not enable billing, upgrade a plan, use batch/flex paid paths, or assume the model ID alone guarantees a free account. Deployment configuration must attest the free-only account and approved data controls before runtime extraction can be enabled.
- **OpenRouter:** allow only vision-capable text-output models whose current advertised input, output, image, and request pricing is zero; require a supported free endpoint, approved underlying provider, and compatible privacy policy. Exclude automatic routers, paid variants, paid document/PDF plugins, tools, and BYOK routing. Disable provider/model fallbacks explicitly and constrain price to zero. Reject missing/unknown pricing rather than assuming it is free.
- A quota, balance, auth, unsupported-model, policy, price, or availability failure disables that extraction attempt. No recharge, credit purchase, plan change, new paid service, or automatic paid fallback.

Keys are read by the backend only. Never use `VITE_` variables for secrets. Adding documented environment variable names and configuration parsing is allowed after plan approval; reading or changing private production secret files is not.

## Data-processing approval

Implement an off-by-default backend gate for externally processing documents, distinct from non-secret provider/model preferences. The gate is configured only for an owner-approved processing context. UI toggles alone cannot authorize production egress.

This task's initial tests use synthetic local documents and mocked provider transports. Do not call a real inference endpoint, including with synthetic fixtures, merely because a key happens to be present. A later live synthetic evaluation requires an explicitly selected provider/model and authorized test credentials. Sending real employee/company documents requires a separate explicit owner approval covering the provider, underlying OpenRouter endpoint if applicable, and data-processing/retention policy.

No Super Admin messages or approvals: Super Admin and automation are frozen. Route routine technical reports and approval requests to the delegated project manager, not to Waleed. The owning session executes and validates; the manager coordinates final delivery. Preserve all rollback, backup, KEEP, audit, and unique work assets.

## Official research and its limits

Checked 2026-11-06/07 without account credentials or inference calls:

- [Groq vision](https://console.groq.com/docs/vision) currently documents `qwen/qwen3.8-27b` image input and JSON output, up to three images per request. It is a candidate for a future synthetic experiment, not an approved default or a tested recommendation.
- [Groq limits](https://console.groq.com/docs/rate-limits) lists a free-plan allowance for that candidate of 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute, and 200,000 tokens/day. Actual account limits can differ; image tokens and output also consume allowance. Recheck before an authorized live evaluation.
- [Groq data controls](https://console.groq.com/docs/your-data) distinguishes default non-retention from reliability/abuse exceptions of up to 30 days, and permits customers to enable Zero Data Retention. No claim has been made that this owner's account already has ZDR enabled.
- [OpenRouter model catalog](https://openrouter.ai/api/v1/models) exposes model capabilities and advertised pricing. It must be filtered and revalidated, not treated as a static guarantee of availability or zero cost.
- [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits) describes free-request limits and account-specific counters. The fetched page did not expose reliable numerical values for its current free allowance; no numeric OpenRouter quota is assumed.
- [OpenRouter provider policies](https://openrouter.ai/docs/guides/privacy/provider-logging) vary by underlying endpoint. [Routing controls](https://openrouter.ai/docs/guides/routing/provider-selection) include `allow_fallbacks`, `data_collection`, `zdr`, `only`, and `max_price`. Use compatible controls together; no eligible approved endpoint means no extraction, not weaker privacy.

Existing API access, free allowances, privacy settings, and live extraction quality have not been verified for the owner's accounts. Mocked transport tests establish application behavior, not OCR quality or external availability.

## Verification and acceptance

The implementation plan must include concrete checks for:

1. Both form entry points: image/PDF preparation, visible extraction/review/failure status, editable suggestions, and explicit final save.
2. Missing number saves successfully; zero-prefixed and alphanumeric numbers round-trip; overlong values fail validation; new documents never inherit a prior number.
3. Missing/ambiguous dates stay empty; final-save validation remains authoritative; expiry before issue is rejected.
4. Existing catalog matching, unknown/ambiguous labels, forbidden identity fields, invalid JSON, overlong output, and document prompt-injection text.
5. Races: editing or clearing while loading, restored drafts, rapid file replacement, removal, retry, account/context switch, discard, close, and late responses.
6. Multi-page conflicts, all-page coverage, corrupted/encrypted PDFs, spoofed MIME types, unsupported files, dimension/size/page limits, timeout, and cancellation.
7. Disabled/unconfigured/unapproved state makes zero provider calls; authorization is checked on the backend; keys and payloads are absent from public responses and logs.
8. Zero-price eligibility, pricing changes, provider/model removal, missing account approval, no eligible privacy-compliant endpoint, 401/402/403/429/5xx, cooldown, and zero fallback calls.
9. Isolated migration upgrade/repeat execution, existing-row preservation, draft restoration, explicit save transactions, attachment staging/retries, and document export handling.
10. Bilingual Arabic/English labels and RTL behavior. Preserve the independent mobile-dialog fix; verify integration deliberately when available.

Run the relevant existing document/form/API/config suites and the added focused tests, plus `npm run typecheck`, `npm run lint`, and `npm run build`. Run `clean-code-guard`, `test-guard`, `docs-guard`, and the final `requesting-code-review` gate. Separate mocked behavior, actual UI verification, and any later authorized external evaluation in the evidence; do not claim one proves another.

The completed task ends with reviewed local commits on the authorized branch. Spec and plan are committed separately according to V2 after their required review; implementation follows the approved numbered plan. No push, pull request, merge, production inspection, deployment, shared migration, live notifications, credential consumption, or cleanup is part of completion.
