# Future document extraction

Status: owner-requested backlog, 2026-11-05. Start only after the current document workflow, scheduler, WhatsApp and email work is stable. This is not part of the active reminder correction batch or production release.

The owner wants an AI/OCR layer to read uploaded PDF, JPG and PNG documents and populate the document form: document type, issue date, expiry date, ministry and other readable fields. Unreadable or absent fields must not receive invented values. Proposed interaction: show extracted suggestions in the form for administrator review before persistence; detailed behavior remains for the future specification.

Settings should offer provider selection (OpenRouter or Groq) and a model selector showing models available from the selected provider. API credentials belong only in backend production environment configuration, never browser bundles or responses. Exact environment-variable names and a secure entry flow will be specified during implementation; no credentials or environment changes are requested now.

The intended budget is free models/free quota only. Provider catalogs, document/image support, rate limits, quota availability, privacy terms and retention must be checked at implementation time. No particular model or continuing free entitlement is promised. Do not enable a paid fallback automatically. Establish document-sharing consent, file/page limits, extraction validation, Arabic/English handling and uncertainty/error behavior before activating an external provider.

No OCR dependency, provider call, upload forwarding, production setting or automatic-save behavior is implemented by recording this backlog item.
