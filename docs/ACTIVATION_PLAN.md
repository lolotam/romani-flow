# Activation plan

The code of every lane is merged or green. What is left is activation, owner
evidence, and the product lanes that were never started. This document is the
order of the work, the gate in front of each step, and the environment each
step needs.

Nothing here activates anything on its own. Every activation step is an owner
decision, and the order below is the order the owner approved.

## Decisions on record (2026-11-17)

| # | Decision | Choice | Why |
| --- | --- | --- | --- |
| 1 | Order of activation | The production diagnosis first, then the merged SMTP feature | The relay of the workspace is the default and the relay of a member overrides it. The identity of a member is the account of the native authentication, so the feature no longer waits for a Clerk switch. |
| 2 | AI extraction provider | Groq, free allowance only, no paid fallback, synthetic documents first | The budget is the free allowance. A paid model is refused by the policy, so the choice has to be a free one. |
| 3 | SMTP relay | A public relay; `SMTP_ALLOWED_HOSTS` stays empty | A public relay needs no exception to the destination policy. |
| 4 | Export wording | §10 of the design governs; §12 is corrected | The export is owner-scoped and the design allows non-secret configuration in it. |
| 5 | Order of the pull requests | The diagnosis pull request first, then the member SMTP pull request | The diagnosis answers why the test failed in production; the feature that follows depends on nothing else. |
| 6 | DNS rebinding | Documented residual risk, not closed now | Closing it means pinning the resolved address with SNI, a deeper change in the transport layer. |
| 7 | OCR engine and batch ingestion | A separate lane, after the activation | The current flow (upload, human review, explicit save) is the requirement. OCR and batch are new product work, not defects. |
| 8 | WhatsApp W1–W9 | A separate lane, frozen for now | The scope is closed and its suite is green; its acceptance needs its own evidence. |

## Phase 1 — The diagnosis in production (PR #29)

The test button used to answer with one generic sentence about the connection.
It now names the reason: the relay refused the credentials, the relay did not
answer, the host is not allowed, or the request never reached the application.

| # | Task | Owner gate |
| --- | --- | --- |
| 1.1 | Merge the diagnosis pull request — merging `main` deploys | **approval** |
| 1.2 | After the deploy: press the test button and read the code in the toast | — |
| 1.3 | If the code is `invalid_response` or `network_error`: read the container log in Dokploy | — |
| 1.4 | If the code is `smtp_timeout` or `connection_failed`: check the egress to the relay port from the container | — |
| 1.5 | If the code is `smtp_rejected`: correct the user, the app password or the sender | — |
| 1.6 | The WhatsApp pairing panel names the variables that block it; with the variables in place the remaining cause is the provider, and the container log carries its code | — |

## Phase 2 — The merged SMTP feature (member relay over the workspace relay)

The relay of the workspace stays the default. A member may save a relay of their
own, and it overrides the relay of the workspace for that member only. A
workspace names the account that sends its scheduled reminders.

| # | Task | Owner gate |
| --- | --- | --- |
| 2.1 | Set `APP_ENCRYPTION_KEY` in the Dokploy environment | owner value |
| 2.2 | Leave `SMTP_ALLOWED_HOSTS` empty (public relay) and `SMTP_ALLOW_PLAINTEXT_HOSTS` empty | none |
| 2.3 | Restore a backup to a copy and rehearse the migration | **approval** for the production copy |
| 2.4 | Merge the member SMTP pull request — merging `main` deploys | **approval** |
| 2.5 | After the deploy: the health check, the image id, a member who saves a relay, a test mail to their own account, and the designated sender | — |

The rehearsal is additive: `013_member_smtp_settings.sql` adds a table and one
nullable column, and the previous image ignores them, so the rollback is the
image alone.

## Phase 3 — AI extraction

| # | Task | Owner gate |
| --- | --- | --- |
| 3.1 | Create the Groq account and take the free key | owner action |
| 3.2 | Read the live catalogue of the provider: `node --import tsx scripts/verify-extraction-activation.mjs --discover` | none — it sends no document |
| 3.3 | Prove the reviewed model: `node --import tsx scripts/verify-extraction-activation.mjs --prove` | **approval** of the model |
| 3.4 | Set the environment: `GROQ_API_KEY`, `AI_EXTRACTION_APPROVALS_JSON`, `AI_EXTRACTION_PROCESSING_AUTHORIZED`, `AI_EXTRACTION_CONTEXT`, `AI_EXTRACTION_GROQ_FREE_ACCOUNT`, `AI_EXTRACTION_DATA_CONTROLS_APPROVED` | owner values |
| 3.5 | Enable `ai_extraction.enabled` in the settings, with the provider and the model | **approval** |
| 3.6 | Evaluate on synthetic documents only, and record the accuracy | — |
| 3.7 | Approve real employee and company documents | **separate approval** |
| 3.8 | The standing routine: the provider catalogue, the quota, the privacy and the retention are re-read on a fixed date | **approval** of the routine |

The reviewed Groq model is `qwen/qwen3.8-27b` with three images, the endpoint
`groq` and the policy version `2026-11-08`. The approval entry expires; the
template lifetime is 180 days, and an expired approval is never honored.

The feature fails closed in every direction: an unapproved model, an expired
approval, a missing attestation, a model that is not free, a provider that
retains the request, or a missing key all refuse the request.

## Phase 4 — Owner evidence

These are the rows of the acceptance ledger that only the owner can close.

| # | Task | Owner gate |
| --- | --- | --- |
| 4.1 | The successful browser save and retrieval journey, on a live designated account | — |
| 4.2 | The `nextRun` read after the release | — |
| 4.3 | The focused review of `docs/OPERATIONS.md` | — |
| 4.4 | The release acceptance and the freeze | **approval** |
| 4.5 | The WhatsApp W1–W9 disposition | **approval** |

## Phase 5 — Separate lanes (not on the critical path)

- The OCR engine: no text recognition exists today, because the provider reads
  the page image. It needs an engine, an accuracy study on Arabic documents and
  a cost decision.
- Batch and unattended ingestion, with its uncertainty and error behavior.
- The consent flow that shares a document with a provider.
- The DNS rebinding hardening of the relay destination policy.

## The production environment

| Variable | Value | Where |
| --- | --- | --- |
| `APP_ENCRYPTION_KEY` | 32 bytes, unpadded base64url | Dokploy, before phase 2.4 |
| `SMTP_ALLOWED_HOSTS` | empty — the relay is public | Dokploy |
| `SMTP_ALLOW_PLAINTEXT_HOSTS` | empty — production never allows a cleartext session | Dokploy |
| `GROQ_API_KEY` | the free Groq key | Dokploy, before phase 3.5 |
| `AI_EXTRACTION_APPROVALS_JSON` | the approval entry of the reviewed model | Dokploy, before phase 3.5 |
| `AI_EXTRACTION_CONTEXT` | the processing context, at most 128 characters | Dokploy, before phase 3.5 |
| `AI_EXTRACTION_PROCESSING_AUTHORIZED` | `true` | Dokploy, before phase 3.5 |
| `AI_EXTRACTION_GROQ_FREE_ACCOUNT` | `true` — the free allowance only | Dokploy, before phase 3.5 |
| `AI_EXTRACTION_DATA_CONTROLS_APPROVED` | `true` | Dokploy, before phase 3.5 |

The provider key and the encryption key are the two values that must never
appear in a chat, a commit, a CI log or a screenshot. The scripts in
`scripts/` read them from the environment of the shell and redact everything
that looks like a credential before they print a receipt.

The member SMTP feature no longer needs `AUTH_PROVIDER=clerk` or
`LEGACY_CLAIM_EMAIL`. The identity of a member is the account of the native
authentication, so the feature does not wait for the Clerk switch. The Clerk
switch remains its own lane with its own runbook.
