# AI document extraction

Status: implemented in the local repository and **disabled by default**. This
document describes the local implementation and its final integration fixes; it is an operational
contract, not an activation instruction and not a release note. Nothing has been
published or deployed: the terminal state is reviewed local commits.

Nothing in this document enables the feature. The feature needs three separate
things to be true at the same time, and none of them is a code change:

1. the persisted administrator preference `ai_extraction.enabled` is `true`;
2. the backend environment carries the owner's processing authorization
   (`AI_EXTRACTION_PROCESSING_AUTHORIZED=true`, a non-empty
   `AI_EXTRACTION_CONTEXT`, the data-control attestations and an unexpired
   approval entry in `AI_EXTRACTION_APPROVALS_JSON`);
3. a provider key is present for the selected provider.

Until all three hold, the feature is inert: manual file selection, metadata
drafts and Save keep their existing behavior, and **no document byte is sent
to a provider**. Ordinary Save still uploads the attachment to the application's
own server — the disabled extraction adds nothing to that path.

---

## 1. What the feature does

An administrator selects one PDF, JPEG or PNG in a document form. The browser
prepares **every** page of that file locally into bounded page images, sends
them once to the backend, and the backend forwards them to the selected provider
in contiguous batches. The provider answer is normalized into field candidates
that the administrator reviews inside the form. A candidate the server marked
`clear` may fill an empty, untouched field automatically. Valid review
alternatives can be accepted explicitly; missing or invalid values require
manual entry. The title always needs an explicit accept action.

The panel shows plain text, the reason a candidate was not applied, and no
percentage, no confidence number and no raw provider output.

---

## 2. Default state

| Item | Default | Source |
|---|---|---|
| `ai_extraction.enabled` | `false` | `server/repositories/settings.ts` |
| `ai_extraction.provider` | `''` (empty) | same |
| `ai_extraction.model` | `''` (empty) | same |
| `AI_EXTRACTION_PROCESSING_AUTHORIZED` | unset / `false` | `server/extraction/config.ts` |
| `AI_EXTRACTION_CONTEXT` | empty | same |
| `AI_EXTRACTION_APPROVALS_JSON` | `[]` | same |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` | empty | same |

The configuration reader fails closed. A malformed approval list, a duplicate
`provider:model` pair, a missing context, a missing authorization flag or an
approval list with more than 20 entries all leave the feature disabled, and an
invalid approval list is discarded entirely instead of being partially used.
`AI_EXTRACTION_PROCESSING_AUTHORIZED` is enabled by the exact string `true`;
`TRUE`, `1` and `yes` do not enable it.

---

## 3. Endpoints

The router is mounted at `/api/document-extraction` behind the session
authentication and the administrator role check
(`server/app.ts`, `server/routes/documentExtraction.ts`). Every answer carries
`Cache-Control: no-store`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/document-extraction/status` | Status of the feature, non-secret |
| `GET` | `/api/document-extraction/candidates?provider=groq\|openrouter` | Offline candidate catalogue, no transport call |
| `GET` | `/api/document-extraction/models?provider=groq\|openrouter` | Live provider listing, **403 while disabled** |
| `POST` | `/api/document-extraction` | Runs one prepared document |

`GET /status` answers with `enabled`, `provider`, `model`, `configured.groq`,
`configured.openrouter`, `processingAuthorized`, `processingContext`,
`available`, `reason`, `settingsVersion`, `catalogVersion` and
`maxSourceBytes`. It carries booleans and labels only: no key, no key prefix,
no key suffix and no approval payload ever reaches the browser.

`POST /` additionally requires the authenticated admin cookie **and** the
`x-draft-account` header to equal the session account. A foreign origin is
refused (`403 invalid_origin`), a foreign account is refused
(`409 account_mismatch`), a body that is not `application/json` is refused, an
encoded body is refused (`415 unsupported_media_type`), and the route uses its
own JSON parser with a 10 MiB limit so the global 2 MiB limit of the
application is untouched.

The admission checks of `POST /` run before the body is decoded and before a
slot is taken (`service.preflight`, `service.acquire`), in this order:

| Condition | Answer |
|---|---|
| `ai_extraction.enabled` is `false` | `403 extraction_disabled` |
| The environment is not authorized, or the context is empty | `403 processing_not_authorized` |
| No provider or no model is selected | `403 extraction_disabled` |
| The selected model has no approval | `403 provider_policy` |
| The provider has no key | `403 provider_not_configured` |
| A privacy attestation of the provider is missing | `403 processing_not_authorized` |
| The account is in a provider cooldown | `429 provider_rate_limit` with `Retry-After` |
| The global or the per-account slot is taken | `429 concurrency_limit` |

### 3.1 The offline candidate catalogue

`GET /candidates` is **local only**. It reads the current approvals, the
configured keys and the privacy attestations of the server and performs no
transport call whatsoever, so it works with zero egress even while the feature
is disabled and the provider is unreachable.

The answer is `{ verification: 'offline', candidates: [...], reason: ... }`.
The persisted `enabled` flag is deliberately ignored: the catalogue answers
"what may I choose locally", never "what may I process now".

`reason` is one of five values, and they are checked in this order
(`server/extraction/candidates.ts`):

| `reason` | Meaning |
|---|---|
| `processing_not_authorized` | The environment is not authorized for processing (no authorization flag or no context) |
| `unconfigured` | No key for the requested provider |
| `policy_unavailable` | The privacy attestations of the provider do not hold |
| `no_candidates` | Everything is local, but nothing survives the local filters |
| `locally_approved` | At least one local candidate exists |

Local candidate rules:

* Groq — the model must be a reviewed capability whose image count matches the
  approval exactly. The reviewed capability record currently holds one entry:
  `qwen/qwen3.8-27b` with `maxImages: 3`.
* OpenRouter — `maxImages` must be `1`, the model id must end with `:free`, and
  the model must not belong to a routing family (`openrouter/...`).
* In both cases the approval must be unexpired and must carry a non-empty
  `policyVersion`.

**The catalogue is a local approval, not a proof of live availability.** A
candidate can be listed while the provider no longer serves the model, no
longer serves it free, or no longer accepts images. The interface says so
instead of pretending the availability is known.

### 3.2 The live listing stays closed

`GET /models` performs a real provider call and therefore stays closed while
the feature is off. The checks run in this order
(`server/extraction/service.ts`):

* `ai_extraction.enabled` is `false` → **`403 extraction_disabled`**, before any
  network call;
* not authorized or no context → `403 processing_not_authorized`;
* a missing privacy attestation of the provider → `403 processing_not_authorized`
  (the attestations are proven before the key is read);
* no key for the requested provider → `403 provider_not_configured`;
* otherwise the live catalogue of the provider is fetched and intersected with
  the unexpired approvals.

A failing listing is reported as a failure. It never substitutes a model, never
resets the current selection and never falls back to the offline list.

The settings card does not use this endpoint: it lists the offline candidates
of §3.1. The live listing exists in the typed client and in the API, and it
stays closed as long as the feature is disabled.

---

## 4. Choosing a provider and a model

The choice is always an explicit act of the administrator:

* the settings card is admin-only (the role is read from the session, so a
  viewer never sees it, and the backend checks the authority again on write);
* the provider is a plain select with three entries: *not chosen*, `groq`,
  `openrouter`;
* the model list is the **offline candidate catalogue** of the server, so it
  contains no free text and no model that the local records do not allow;
* the card never shows a key, never offers a free-text model, never tests a
  provider and never links to a billing page;
* switching the extraction **off** never needs a provider, a model or a
  catalogue: the switch stays operable whenever the feature is currently on.
  Switching it **on** is only possible when the status is known, the
  environment is authorized, a provider and a model are chosen, the provider is
  configured and the chosen model belongs to the current catalogue;
* the card fails closed as well: if the authoritative status could not be
  loaded, the **Save button stays disabled** until a successful Refresh has
  loaded it. A status failure is therefore not a way to write a preference, and
  there is no bypass — the backend refuses a write it cannot validate in any
  case.

A saved model that the current catalogue does not offer stays visible and is
never erased; it is only marked as unavailable. The catalogue is never chosen
automatically, and the feature never selects a provider or a model on its own.
There is **no automatic retry, no automatic provider or model change, no paid
fallback, no tool use and no PDF plugin** in the request path. A failed attempt
leaves manual entry fully available.

---

## 5. Enabling: fresh validation and the write boundary

`PUT /api/settings` is the only way to change the extraction preference. When
the request touches an `ai_extraction.*` key and the effective result would be
enabled, the server:

1. **validates the effective selection** — a disabled selection is always
   allowed; an enabled selection needs a provider, a model, an authorized
   environment and a candidate that resolves against the local approvals;
2. **proves the candidate against fresh provider metadata** — for Groq the live
   model list of the provider, for OpenRouter the model list, the endpoint
   record, the zero-data-retention record and the private-key inventory, each
   read at that moment and each held to the conditions of §9.1. The authority
   of the selection is re-read after every metadata call, so a revoked role, a
   changed context or a revoked approval stops the request while it is still in
   flight. A revoked or a paid candidate is therefore refused before a single
   setting is written;
3. **holds an immutable authority snapshot** — the requested provider, model,
   context and the approval it was resolved from;
4. **re-reads the authority before the first write** — a role, a context or an
   approval that changed while the remote proof was pending refuses the whole
   request, so a mixed request never writes half of its settings;
5. **re-reads the authority again at the real write boundary** — the assertion
   runs inside the settings coordinator, after every `await` and directly before
   the settings are applied, so no `await` separates the guard and the write.

A refusal is a fixed `400 invalid_settings` with the reason on
`ai_extraction.enabled`. Nothing is written and no provider is activated.

---

## 6. The request contract

The shared contract is `server/contracts/documentExtraction.ts`. The browser
and the backend validate the same wire shapes with it, so a prepared page, a
raw provider page and a normalized result have exactly one definition. The
schema is the authority; the prompt JSON schemas only mirror it.

### 6.1 Hard limits

| Limit | Value | Meaning |
|---|---|---|
| `limits.pages` | `10` | Pages per document |
| `limits.pixels` | `4_000_000` | Decoded pixels per image |
| `limits.body` | `10 * 1024 * 1024` | Request body limit (10 MiB) |
| `limits.source` | `20 * 1024 * 1024` | Source file limit (20 MiB) |

### 6.2 The request

```text
requestId      uuid
scope          string, max 128
context        string, 1..128
settingsVersion  string, exactly 64 characters
catalogVersion   string, exactly 64 characters
pageCount      integer 1..10
images         array, 1..10 items
```

Each image is `{ page: integer 1..10, mime: 'image/jpeg' | 'image/png',
base64: string }`. The request is `strict`: an unknown key is a rejection. The
image count must equal `pageCount` and the page numbers must be `1..n` in
order, so a partially prepared document can never be sent.

The endpoint accepts **no** URLs, file paths, file names, provider endpoints,
provider keys or arbitrary document fields.

### 6.3 The result

```text
requestId      uuid
context        string, max 128
settingsVersion / catalogVersion  64 characters
pageCount      integer 1..10
fields         { title, document_number, document_type_id, ministry_id,
                 issue_date, expiry_date }
```

Each field is a candidate:

```text
value        string(max 128) or null
state        'clear' | 'review' | 'missing'
alternatives array of at most 10 strings (max 128 each)
reason       'none' | 'uncertain' | 'invalid' | 'conflict' | 'catalog'
```

`clear` carries a usable value and requires `reason: 'none'`; `review` and
`missing` carry no value at all, so an unresolved suggestion can never be
applied. `missing` carries no alternatives either.

The result is additionally checked as a whole: a title is at most 120
characters, a document number is trimmed, both dates must be real calendar
dates, and an expiry date that lies before the issue date is rejected.

---

## 7. Local preparation

The preparation runs in the browser. It reads the source once, decides from the
bytes what the file really is, and refuses anything that is not a supported
document. During the preparation **no document byte is uploaded and no external
host is contacted**; the renderer does load its worker and its pinned PDF.js
assets over HTTP from the application's own origin (§7.1), so the preparation
is not literally free of network requests — it is free of *provider* traffic
and of file uploads.

* Accepted: PDF (`application/pdf`, `.pdf`), PNG (`image/png`, `.png`), JPEG
  (`image/jpeg`, `.jpg`/`.jpeg`). The declared type **and** the file name must
  agree with the signature; a renamed document is refused.
* the source bound is checked before the bytes are read, so an oversized file
  is refused without being loaded. The bound is the `maxSourceBytes` value of
  the status: `min(limits.source, config.maxUploadBytes)`. The shared hard
  maximum is **20 MiB**; lowering `MAX_UPLOAD_MB` also lowers the advertised
  extraction source bound. The picker still has its separate 20 MiB limit.
* A JPEG or PNG is a single page and is **never** downsampled: an oversized
  picture fails instead of being silently shrunk.
* A PDF is rendered page by page into JPEG page images at quality `0.85`. The
  renderer refuses a document with more than 10 pages, a rendered page above
  4,000,000 pixels or an edge above 8192 pixels, more than 50,000 operators per
  page, more than 16,000,000 image-operand pixels per page or more than
  16,000,000 inline image bytes per page. The whole preparation has a **30 second**
  deadline (`DEADLINE_MS` in `src/lib/extraction/pdf.ts`). The caller is rejected
  at the deadline even if browser-owned encoding has not physically settled.
* The pinned PDF.js release is configured to **report** its diagnostics instead
  of swallowing them, and the dedicated worker turns a diagnostic into a
  rejection. This matters: with the swallowing behaviour the renderer removes
  an oversized image and the page content disappears while the preparation still
  reports success. Here the document is either prepared completely or refused
  completely.
* An encrypted document is refused; a password is never requested.
* The encoded request is checked against a 10 MiB budget (including an
  envelope allowance) before and after every page, so an oversized document
  fails instead of being sent half prepared.

**All pages or none.** A partially prepared document is never returned.

### 7.1 Local, pinned assets

The renderer reaches **no external host** for an asset: every asset comes from
the application's own origin. The pinned release `6.5.438` of `pdfjs-dist` is
installed as a normal dependency, and the Vite plugin `romani-pdfjs-assets`
serves only an allowlist of four directories of that installed package:

```text
/pdfjs/6.5.438/cmaps/
/pdfjs/6.5.438/standard_fonts/
/pdfjs/6.5.438/wasm/
/pdfjs/6.5.438/iccs/
```

The development server and the preview of a build answer exactly these files
and refuse every other path; the build emits exactly the same files under the
same names, so the application behaves identically in both modes. A request is
never turned into a file-system path. `pdfjs-dist` is excluded from the
dependency pre-bundling, and the renderer runs in its own ES-module worker.

---

## 8. Image admission on the server

Every received page image is admitted before it can be used:

* the base64 payload must be canonical and the declared MIME type must agree
  with the file signature;
* the header of every image is inspected **before** any image is fully decoded;
* exactly one image is decoded at a time and its pixels are dropped
  immediately;
* an edge above 8192 pixels, more than 4,000,000 decoded pixels or a raw
  buffer above 16,000,000 bytes is refused;
* the native decode carries a 3 second decode timeout.

**The native decoder is Sharp** (`sharp` `0.35.5`, the default). The decoder
may be replaced by an injected factory in a test, but the injection is internal:
it is not reachable from a request, a setting or the environment, and it never
changes the rules.

### 8.1 Native settlement

A cancellation does **not** stop the native operation instantaneously. The
decoder may outlive the caller: the request is rejected while the native decode
keeps running. The response is therefore never delayed by the native work, but
the admission slot of the request is only released once the native work has
really settled. A burst of cancelled requests cannot outrun the native work.

---

## 9. The provider request

The provider, the model, the endpoint and the key are never taken from the
request. They come from the settings and the owner approvals and are checked
again before every outbound call and again before the result is returned.

* The base URLs are fixed in the code (`https://api.groq.com/openai/v1` and
  `https://openrouter.ai/api/v1`), and only a fixed set of paths is ever used
  (`server/extraction/http.ts`):

  | Destination | Path |
  |---|---|
  | Groq model list | `/models` |
  | Groq inference | `/chat/completions` |
  | OpenRouter model list | `/models` |
  | OpenRouter endpoint list of one model | `/models/{author}/{slug}/endpoints` |
  | OpenRouter zero-data-retention inventory | `/endpoints/zdr` |
  | OpenRouter private-key inventory | `/byok?limit=1&offset=0` |
  | OpenRouter inference | `/chat/completions` |

  The path a provider URL may carry besides the model is restricted to
  `/models` and `/chat/completions` per provider; the endpoint list URL is
  built only from the two validated segments of a model id. A request never
  carries a caller-supplied host, path or query beyond these fixed ones, and
  redirects are refused (`redirect: 'error'`).
* The pages are sent in contiguous batches of `maxImages` (from the approval),
  one batch after the other. The result is built only when every batch
  succeeded, so a partial answer never reaches the browser.
* The output is capped at 4096 tokens. The **response** of the provider is
  bounded twice: the upstream JSON envelope at 64 KiB and the message content
  inside it at 16 KiB. A larger answer is refused instead of being buffered.
  The 16 KiB bound is a bound on what the provider sends back; it is not a
  bound on the request.
* The private-key inventory of the routed provider needs management access. A
  workspace without that access stays unavailable; it is never read as an empty
  inventory, so a missing access can never prove that no private key is
  attached.
* The answer of the provider is checked against the raw contract. The model
  identity of the answer is compared **only when the provider returns a model
  field**: a present, different model is refused
  (`502 provider_identity_mismatch`), and an absent model field is not a
  mismatch. **No returned endpoint id is compared** — the routed provider's
  endpoint is pinned in the request body (`provider.only` / `provider.order`)
  and was proven before the call, not read back from the answer. This is a
  recorded limit of the current implementation, carried into the Task 17 audit
  scope.

### 9.1 Fixed cost and privacy conditions

These conditions are fixed in the code; they are not configurable per request.

**Groq**

* the environment must attest a **free-only account**
  (`AI_EXTRACTION_GROQ_FREE_ACCOUNT=true`);
* the data controls must be approved
  (`AI_EXTRACTION_DATA_CONTROLS_APPROVED=true`);
* the model must be a reviewed capability with the exact reviewed image count;
* the model must be present in the fresh model list of the provider.

**OpenRouter**

* `AI_EXTRACTION_DATA_CONTROLS_APPROVED=true`,
  `AI_EXTRACTION_OPENROUTER_NO_BYOK=true` and
  `AI_EXTRACTION_OPENROUTER_ZDR_ONLY=true`;
* the model must be free (`:free`), must not be a routing model, must accept
  images and answer with text, and must support the parameters the pipeline
  sends;
* the **pricing must be zero in all four advertised dimensions** — `prompt`,
  `completion`, `image` and `request`. A missing dimension, an exponent, a
  negative value or an unreadable representation is a refusal: a price that
  cannot be read as zero is not a zero price;
* the endpoint must be healthy (`status: 0`), must carry the exact approved
  tag and must be zero-priced as well;
* the zero-data-retention record must match the model and the tag and must not
  request safety retention;
* the private-key inventory must be empty.

Unknown cost, unknown policy, a catalog failure or an authorization failure
prevents the inference. A paid fallback is never used automatically.

### 9.2 Concurrency and timeouts

| Bound | Value | Source |
|---|---|---|
| Concurrent extractions, whole server | `2` | `server/extraction/service.ts` |
| Concurrent extractions, one account | `1` | same |
| Body delivery deadline | `15_000 ms` | same |
| Overall operation deadline | `45_000 ms` | same |
| One metadata request | `5_000 ms` | same |
| Metadata response size | `8 MiB` | same |
| Provider response envelope | `64 KiB` | `server/extraction/provider.ts` |
| Provider response message content | `16 KiB` | same |
| Output tokens per request | `4096` | same |
| Browser request timeout | `90_000 ms` | `src/lib/api/documentExtraction.ts` |
| Local preparation deadline | `30_000 ms` | `src/lib/extraction/pdf.ts` |
| Provider cooldown | `1..300 s` | `server/extraction/service.ts` |

A rate-limited answer starts a cooldown for the account. The announced
cooldown is bounded to 1..300 seconds and the server also caps its own
cooldown at 300 seconds.

### 9.3 The vocabulary of the answer

A provider answers in its own words. It writes `certain` where the contract
writes `clear`, and it writes `Gregorian` where the contract writes
`gregorian`. Such an answer is a correct answer that used another word, and
the server translates the words before the contract reads the answer
(`server/extraction/answerVocabulary.ts`).

The translation changes words and never changes values:

* the certainty becomes `clear`, `uncertain` or `missing`; a word that names
  no certainty we know becomes **`uncertain`**, so the value reaches the form
  as a suggestion the administrator confirms and never as a value that is
  written automatically;
* the calendar becomes `gregorian` or `unknown`; a word that names no
  calendar we know becomes **`unknown`**, so a date of a calendar we do not
  read is never applied;
* a page number that is written as a canonical text (`"1"` … `"10"`) becomes
  the number it names; every other text stays a text and is refused;
* a date that arrives without its own `source` and `calendar` receives the
  most careful values (`null` and `unknown`), so it is read but never
  applied.

### 9.4 The grounding of a date

A document writes its dates in the order of its country: a civil id in Kuwait
writes `15/01/2024` and a document from elsewhere writes `2024-01-15`. Both
are the same calendar and the same digits. The provider reports that day in
the Gregorian calendar as `2024-01-15` and repeats the text of the page as
`15/01/2024`, so a date whose source repeats the day in another order is
still the day the provider read
(`server/extraction/dateSource.ts`).

A date is applied when the provider reports it twice and both reports carry
the same day — once as the value and once as the text of the page:

| Source | Value of the provider | Applied |
|---|---|---|
| `2024-01-15` | `2024-01-15` | yes — the source repeats the date |
| `15/01/2024` | `2024-01-15` | yes — the source determines the day, the month-first reading is not a real calendar date |
| `15/01/2024` | `15/01/2024` | yes — the provider read the day in the order of the page |
| `Expiry Date` | `2024-01-15` | yes — the source names the field, so it carries no digits to contradict |
| `١٥/٠١/٢٠٢٤` | `2024-01-15` | yes — the digits of the source are written the way the contract writes them |
| `05/06/2024` | `05/06/2024` | **no** — neither the value nor the source determines a day, so the administrator confirms it |
| `01/11/2024` | `2024-11-01` | **no** — the source names two real days, so the page does not determine the day |
| `03/07/2019` | `2024-01-15` | **no** — the source carries other digits |
| `2024-01-15` | `2024-01-15`, `calendar: unknown` | **no** — the calendar is not the Gregorian one |

Nothing is converted and no component is invented: every digit of an applied
date comes from the value or from the source, and a day that neither of them
determines is never applied. A date that is not applied stays a suggestion
for the administrator with the reason `uncertain`.

Everything else stays strict. A value that is too long, a page that is
missing or repeated, a document number that arrives as a **number** (the
number has already lost the leading zeroes and the separators an identifier
needs, see §11), an unknown key, a `reasoning_content` instead of a content,
and a content that is not JSON are all refused exactly as before. No partial
page is salvaged, no second attempt is made, and no provider is tried again.

The instruction of the request names the words of the vocabulary, because a
provider that is left to guess writes its own word. The example of the
request keeps its values empty on purpose: an example that shows a number
teaches the model that a number is a normal answer, and a model that answers
with the example has answered with a number that was never on the page.

A refusal is recorded in the log of the server with its code, its status,
its request id and the place of the answer that was refused
(`[extraction] refused code=… status=… request=… detail=…`). The place names
a field of the contract and a word of our vocabulary, never a value of the
document, a key, a file name or an upstream sentence. A word that is not one
of ours is recorded as `other` and never as it was written, because a
provider may write a name or a sentence of the document in the place of a
word, and a short name satisfies every shape.

A status that the provider names no reason for is a **refused request**
(`502 provider_request_rejected`), not an answer we could not read
(`502 provider_malformed_response`). The two are different failures and the
administrator sees a different copy for each.

---

## 10. Suggestions, provenance and the forms

### 10.1 What may be written automatically

Only an **empty** field that no administrator touched since the request started
may be filled automatically. This automatic fill of a `clear` candidate **is
implemented**, not merely permitted. A suggestion is written only when the
attempt is still the newest one, the field is empty, the field is not protected,
the version of the field did not change since the attempt started and the value
is still the value of the snapshot.

A candidate is eligible only when the server marked it `clear` and the form
supports the field. The title is **never** written automatically, because the
title of a form usually comes from the name of the selected file and only the
administrator may replace it; a title needs an explicit suggestion action.

A deliberate clear and a clear that is followed by an edit back are permanent
protections for the rest of the form session. A restored draft value and a
stored value of an existing document are protected as well. Replacing or
removing the attached file clears **only** the values the machine filled and
that nobody changed afterwards; a value an administrator edited, cleared or
accepted stays. The answer of an obsolete attempt never writes anything.

### 10.2 Provenance

The provenance controller of the form session remembers which values the
machine filled, which values an administrator touched and which request is
still allowed to write. It is pure: it holds no timer, performs no request and
never reads the environment.

| Origin | Effect |
|---|---|
| Machine (a `clear` candidate applied automatically) | The value belongs to the machine until it is cleared or changed. |
| Manual (typing, deleting, restoring the original value) | The field is protected from the first action on it, for the rest of the session. |
| Explicit accept of a candidate | The accept calls the same manual action as a typing, so the field becomes **administrator-owned**: it is protected at once and no later attempt may change it. |
| Draft (a restored draft value) | Protected, including a field that was restored empty. |
| Stored document (an existing document that is edited) | Protected. |

Machine values enter the revisioned metadata draft through the ordinary change
of the draft session, so the order of the writes and the revision of the scope
stay the ones of the session itself. Provider objects, raw OCR, image bytes,
keys and confidence data are **not** persisted: only the applied metadata
enters a draft, and only Save writes the final record.

### 10.3 The fixed identity of an attempt

An attempt belongs to the account, the scope, the form context and the very
file object it started for. A changed account, a changed scope, a changed
context, another file object, a closed form or a form that is not ready any
more end the attempt, even before the interface renders the change.

The two forms have different fixed identities and different supported fields:

| Form | Scope | Context | Fields the machine may propose |
|---|---|---|---|
| General document form | `new`, `employee:<id>`, `company:<id>` or `edit:<id>` | scope, beneficiary type, company id, employee id, type count, ministry count | `ministry_id` is **not** proposed in employee-beneficiary mode, because the general form has no ministry there |
| Employee document form | `employee:<id>` | employee id, type count, ministry count | all six fields, because the employee form knows the ministry |

A candidate of a catalog field (`document_type_id`, `ministry_id`) is stricter
than the other fields: its value is the id the server resolved out of the
catalog, so only the resolved value may be written and no alternative of a
catalog field is ever accepted. Every other field keeps the exact membership
in the proposed values: a date has to be a real calendar date, a number keeps
its leading zeroes and stays a string, and a title stays short.

---

## 11. The optional document number

`document_number` is optional free text, documented in full under
[the optional document number](DOCUMENT_DRAFTS.md#the-optional-document-number).
The contract that matters here:

* the value is trimmed and limited to **128 characters**;
* leading zeros, letters, separators, Arabic-Indic digits and the digits of the
  source are preserved — the number is never parsed into a number;
* an absent or blank value means "no number" (`null`); only strings are
  accepted, a number or a boolean is rejected instead of being coerced;
* duplicates are permitted;
* a **new** record never inherits the number of the preceding document, and an
  **existing** document with its scoped unfinished draft restores its own value;
* the database column is additive and nullable: `documents.document_number
  TEXT DEFAULT NULL` with a check that the value is text and at most 128
  characters.

---

## 12. The approval records

`AI_EXTRACTION_APPROVALS_JSON` is a JSON **array** with at most 20 entries.
Every entry is validated with a strict object schema: an unknown key rejects
the whole list, and a rejected list disables the feature and discards every
record.

| Field | Type | Constraint |
|---|---|---|
| `provider` | string enum | `groq` or `openrouter` |
| `model` | string | at most 128 characters, `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.:-]+$` |
| `endpoint` | string | 1..128 characters, `^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$` |
| `maxImages` | integer | 1..3, and exactly `1` for `openrouter` |
| `expiresAt` | string | an ISO datetime; freshness is checked at the moment of use |
| `policyVersion` | string | 1..128 characters, must not be empty |

No concrete approval record is published here, and none is needed to read this
document. A record is only one of the conditions of §1 and is **not an
activation by itself**: an approval alone enables nothing. The persisted
preference, the environment authorization and the provider key must also hold,
and the live checks of §5 and §9.1 must pass before any request is sent. The
owner composes the records for the deployment, and the owner decides the
values. This document grants no authorization to configure or use one.

---

## 13. Management inventory and its limits

What an administrator can manage and observe today:

* the three persisted preferences (`enabled`, `provider`, `model`) in Settings;
* the two `configured` booleans, which say only whether a key is present;
* the offline candidate catalogue with its reason;
* the explicit accept / cancel / retry actions of one attempt in the form;
* a **Refresh** control that re-reads the status and the offline catalogue.

What is **not** available, by design:

* no key management interface — the keys live only in the backend environment,
  are never written to the database and never returned by the API;
* no approval management interface — the approvals live in the environment
  variable, and the interface never shows an approval, an endpoint or a
  policy payload;
* no live availability, quota, cost or latency indicator — a candidate is
  locally approved, and whether the provider still serves it free is not known
  until a live call succeeds;
* no attempt history, no export of suggestions and no per-attempt audit trail:
  the server never logs the body, the account or the document, and no
  extraction attempt is persisted;
* no live re-verification of a provider from the interface — Refresh never
  calls the provider, so it cannot prove a provider's current state. It is
  exactly the control that has to succeed before the Save button becomes
  usable again after a status failure (§4).

The inventory of an administrator is therefore deliberately small: it shows what
may be chosen, not what will be served.

---

## 14. Migration `009`

`server/db/migrations/009_document_number.sql` is additive:

```sql
ALTER TABLE documents
ADD COLUMN document_number TEXT DEFAULT NULL
CHECK (
  document_number IS NULL OR
  (typeof(document_number) = 'text' AND length(document_number) <= 128)
);
```

It adds a nullable column with a check constraint. It does not rewrite existing
rows, does not backfill anything and does not change any other table. The
column and the previous data are retained when the feature is switched off.

**No production migration is authorized by this work.** The migration still has
to pass the production release/migration gate before it is applied to a
production database.

**Startup migration risk — a separate authorization.** The server applies
pending migrations itself on start (`server/index.ts` calls `runMigrations`
before it serves traffic). A server that boots against a production database
therefore applies `009` on its own, without the release gate having run.
Applying the migration deliberately with `npm run db:migrate` before the
release, and keeping the startup path from applying it, is a separate decision
that needs its own explicit authorization. Nothing in this documentation
authorizes either action.

---

## 15. Verification status

All verification used **synthetic local fixtures and mocked providers**. It
establishes no OCR accuracy, no real quota, no real account privacy setting and
no external availability. Live synthetic evaluation and real employee or
company documents each need their own explicit owner authorization.

The commands below and their recorded results come from the local parent
closure receipts of Tasks 13/14 and 15 (commit `17e57f18`, foundation
`386db6d`). They are **historical parent runs**, attributed to those receipts.
They were **not** re-executed in this documentation checkout: the isolated
checkout has no installed dependencies, and installing them was out of scope for
a documentation task.

| Command | Recorded result | Evidence |
|---|---|---|
| `npm run test:extraction` | 191/191, exit 0 | `task-13-14-parent-closure.md`, `task-15-settings-parent-closure.md` |
| `npm run test:forms` | 79/79, exit 0 | same |
| `node scripts/verify-extraction-forms.mjs` | 18/18, exit 0 | `task-13-14-parent-closure.md` |
| `node scripts/verify-extraction-settings.mjs` (dev / `--built`) | 12/12 each | `task-15-settings-parent-closure.md` |
| `node scripts/verify-extraction-lifecycle.mjs` (dev / `--built`) | 14/14 each | same |
| `node scripts/verify-extraction-browser.mjs --preparation` (dev / `--built`) | 11/11 each | same |
| `npm run typecheck` | exit 0 | same |
| `npm run lint` (includes the size check) | exit 0, warnings only | same |
| `npm run build` | client and server, exit 0 | same |

The `--preparation` browser run above is the preparation path only. It is not
the full browser orchestration, and it is not a proof of the built forms.

The integration suite now includes the real React hook, signed session cookies,
the Express CAS route and in-memory SQLite. Same-account/scope successors wait
for a retiring session's actual work before loading its revision. Cross-account
isolation and genuine competing-writer conflicts remain enforced; there is no
automatic conflict overwrite. The source cap and preparation deadline follow
the limits documented above.

`npm run verify:api:local` runs the existing API verifier against one temporary
loopback service with ephemeral synthetic credentials and stubbed transports.
The final local run reports 47 passed and zero failed. The assembled Node
extraction suite reports 204 passed, zero failed and zero skipped.

The full browser runner executes preparation, lifecycle, settings and forms
sequentially in dev and built modes. Set `BROWSER_ENGINE` to `chromium` (default)
or `firefox` to choose explicitly; an unsupported engine is rejected. The local
validation uses the pinned Playwright browsers Chromium141.0.7390.37 and
Firefox142.0.1. This establishes synthetic behavior, not provider accuracy or
live account eligibility.

Not established by this local validation: actual Safari18/WebKit-device
behavior, a Docker/Alpine native build, external inference quality, production
migration, activation or deployment. Those are not authorized by a passing
local test suite.

---

## 16. Related documents

* [`docs/FUTURE_OCR.md`](FUTURE_OCR.md) — the deferred OCR backlog and how it
  differs from this optional feature.
* [`docs/DOCUMENT_DRAFTS.md`](DOCUMENT_DRAFTS.md) — drafts, the applied
  metadata only rule and the document number.
* [`docs/OPERATIONS.md`](OPERATIONS.md) — daily operation, backup and recovery.
* [`docs/READINESS.md`](READINESS.md) — the operational acceptance ledger.
