# Approved extraction bootstrap contract amendment

Applies to the approved `2026-11-07-ai-document-extraction-design.md` specification and `2026-11-07-ai-document-extraction.md` plan, Tasks 9 and 15. Manager disposition received 2026-11-07 after reviewing `task-15-bootstrap-review.md`. Baseline: `eda6b2a0d5acc39b309175acae22c682f48928ba`.

## Contract

Add authenticated, admin-only `GET /api/document-extraction/candidates?provider=groq|openrouter`. It performs zero external transport calls. It ignores only the persisted UI enabled flag; all local authorization, configuration, capability, privacy attestation and approval-expiry predicates still apply. Candidates must be the intersection of current non-expired local approvals and known local capability rules. No guessed defaults or automatic provider/model selection.

Successful response: `{ data: { verification: 'offline', candidates: ModelChoice[], reason: 'locally_approved' | 'processing_not_authorized' | 'unconfigured' | 'policy_unavailable' | 'no_candidates' }, error: null }`. Candidate objects contain exactly the existing sanitized ModelChoice fields. Unauthorized/unconfigured local state returns an empty list and a fixed reason. Anonymous/viewer access is rejected through actual authentication/role middleware; malformed provider returns `400 invalid_provider`. No keys, raw approvals, endpoint tags or policy payloads are exposed.

`offline` means approved locally, with live availability unverified. It is never evidence of eligibility or permission to process. Existing GET `/models` retains disabled `403` and zero-egress behavior. The UI permits explicit selection while disabled; the atomic enabling PUT still verifies fresh remote cost/privacy/capability plus current role/context before any write. Extraction retains all subsequent freshness checks. Candidate expiry, revocation or later live refusal never triggers fallback or activation.

## Ordered implementation and evidence

1. Gemini high authors bounded real API regressions with valid positive controls: default disabled to candidates to explicit selection to enabling; zero transport before deliberate enabling; both providers; expiry/config/privacy/capability filtering; anonymous/viewer/provider validation; sanitized exact envelopes; unchanged disabled live listing; mixed PUT rollback and live eligibility refusal without fallback.
2. Parent reviews tests and RED classification. MiniMax medium implements only affected shared contract/backend/settings paths in an isolated checkout, preserving existing Task 9 gates.
3. Parent validates focused and affected regression suites, source review and local commit. Task 15 UI uses offline candidates for initial selection and accurately labels unverified live availability. Full UI/browser obligations remain separate.

This resolves first-time configuration, not feature scope, paid-service authority, provider activation or production authority. Terminal remains reviewed local commits only. Task 11 correction is independent and unchanged.
