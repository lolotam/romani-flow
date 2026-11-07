# Future document extraction

Status: owner-requested backlog, 2026-11-05. Start only after the current document workflow, scheduler, WhatsApp and email work is stable. This is not part of the active reminder correction batch or production release.

## Update 2026-11-07: an optional suggestion path exists, this backlog is still open

An optional **suggestion** path of the extraction has since been implemented in
the local repository. It is documented in
[`AI_DOCUMENT_EXTRACTION.md`](AI_DOCUMENT_EXTRACTION.md) and it is **not** the
OCR layer of this backlog. It has not been published or deployed; the terminal
state is reviewed local commits, and the feature is off by default.

What that optional path is:

* an administrator chooses a provider and an approved model explicitly;
* the browser prepares every page of one selected PDF/JPEG/PNG locally and the
  backend forwards it to the chosen provider;
* the provider answer becomes field *candidates* that the administrator reviews
  inside the form: a candidate the backend normalized as clear may fill an
  empty, untouched field automatically. Valid review alternatives and titles
  need explicit acceptance; missing or invalid values require manual entry;
* it is **off by default** and needs an explicit owner processing authorization
  before any document is sent to a provider.

What it is **not**:

* it is not an OCR engine. There is no text-recognition step, no OCR model, no
  OCR dependency and no OCR accuracy claim. The provider reads the page image;
  measured accuracy and any separate OCR engine remain future work.
* it does not deliver the deferred work of this page. The reviewed
  suggestion flow of the original request — read the document, propose the
  fields, let the administrator review them before anything is persisted — is
  implemented. What is **not** implemented is:
  * any measured accuracy on real employee or company documents;
  * an external evaluation of the provider answers (no accuracy, no
    acceptance-rate, no OCR benchmark has been run);
  * recognition of a handwritten or badly scanned document;
  * unattended or bulk ingestion of a whole archive, and the
    uncertainty/error behavior of such a flow;
  * file and page limits beyond the current bounds.

Concretely, the items below stay open:

* real-world OCR accuracy, on real employee and company documents, with the
  owner's explicit authorization. Nothing in the optional path measures or
  claims accuracy.
* the free-model / free-quota promise. The optional path only *refuses* a
  paid or unprovable selection; it does not promise that a free entitlement
  continues to exist.
* provider catalog, rate-limit, quota, privacy-term and retention checks as a
  standing operational routine. The optional path proves the cost and the
  policy of a selection at the moment it is made, not permanently.
* document-sharing consent and the uncertainty/error behavior of a batch or
  unattended flow.
* any activation. The optional path is off, its approvals are empty, and
  neither the recording of this backlog nor the implementation of the optional
  path authorizes a provider, a paid fallback or a production setting.

The remaining paragraph of this page describes the original backlog and is
kept unchanged.

---

The owner wants an AI/OCR layer to read uploaded PDF, JPG and PNG documents and populate the document form: document type, issue date, expiry date, ministry and other readable fields. Unreadable or absent fields must not receive invented values. Proposed interaction: show extracted suggestions in the form for administrator review before persistence; detailed behavior remains for the future specification.

Settings should offer provider selection (OpenRouter or Groq) and a model selector showing models available from the selected provider. API credentials belong only in backend production environment configuration, never browser bundles or responses. Exact environment-variable names and a secure entry flow will be specified during implementation; no credentials or environment changes are requested now.

The intended budget is free models/free quota only. Provider catalogs, document/image support, rate limits, quota availability, privacy terms and retention must be checked at implementation time. No particular model or continuing free entitlement is promised. Do not enable a paid fallback automatically. Establish document-sharing consent, file/page limits, extraction validation, Arabic/English handling and uncertainty/error behavior before activating an external provider.

No OCR dependency, provider call, upload forwarding, production setting or automatic-save behavior is implemented by recording this backlog item.
