# Pinned Evolution text-send contract

Source inspection only, 2026-11-04. No live request, number lookup, QR, pairing,
webhook activation or secret access was performed to establish this contract.
The custom deployed source is `f1100ad8741fb8af5015fc86b11e78e95d50c353`,
Evolution 2.3.7/Baileys. GitHub contents were fetched at that exact commit, not main.

The final Curemed source handoff was read and verified at SHA256
`746bd874f587bced5668145695710fca40957994787a1d80849416d185294c4c`
(`romani-sendtext-source-contract-f1100ad-20261104.md`, controller lines 38–40).
Adapter tests pin this provenance and assert the exact `/message/sendText/romani`
path with no query string. Configuration with a query, fragment, non-root path
or another instance is refused before fetch.

The same origin-only/exact-instance predicate gates reminder status and
enablement. Existing pairing-only prefix/namespace compatibility is retained,
but cannot enable reminders. URL spelling must equal its normalized origin
after removing trailing slashes; an explicit default port is not canonical.

**Separate native isolation gate:** the pinned abstract router merges query
parameters into route parameters after authentication. A malicious native token
holder could therefore override the authenticated instance through a query.
The Romani backend never accepts this routing authority and constructs a fixed
origin/path with no query. Happy-path foreign-route 401 evidence is not proof
against that native query override; its shared-service disposition remains a
pre-live-send gate. No exploit or provider patch was performed here.

## Fixed request and accepted response

- [`index.router.ts`](https://github.com/lolotam/evolution-api/blob/f1100ad8741fb8af5015fc86b11e78e95d50c353/src/api/routes/index.router.ts): `/message` mounts MessageRouter; CREATED is 201.
- [`sendMessage.router.ts`](https://github.com/lolotam/evolution-api/blob/f1100ad8741fb8af5015fc86b11e78e95d50c353/src/api/routes/sendMessage.router.ts): POST `sendText` validates textMessageSchema before executing the controller and returns 201.
- [`abstract.router.ts`](https://github.com/lolotam/evolution-api/blob/f1100ad8741fb8af5015fc86b11e78e95d50c353/src/api/abstract/abstract.router.ts): routerPath appends `/:instanceName`. Romani uses only POST `/message/sendText/romani`, no instance query/body authority.
- [`sendMessage.dto.ts`](https://github.com/lolotam/evolution-api/blob/f1100ad8741fb8af5015fc86b11e78e95d50c353/src/api/dto/sendMessage.dto.ts) and [`message.schema.ts`](https://github.com/lolotam/evolution-api/blob/f1100ad8741fb8af5015fc86b11e78e95d50c353/src/validate/message.schema.ts): top-level `number` and `text`; linkPreview boolean is allowed. Romani sends only `{number: <canonical digits without +>, text: <stored attempt text>, linkPreview:false}`. No quoted message, mentions, delay, presence subscription, attachment or webhook override.
- [`auth.guard.ts`](https://github.com/lolotam/evolution-api/blob/f1100ad8741fb8af5015fc86b11e78e95d50c353/src/api/guards/auth.guard.ts): `apikey` is an instance-scoped header checked against the route's exact instance before execution. The browser never receives it; no master fallback.
- [`sendMessage.controller.ts`](https://github.com/lolotam/evolution-api/blob/f1100ad8741fb8af5015fc86b11e78e95d50c353/src/api/controllers/sendMessage.controller.ts) delegates to native textMessage. The native [`whatsapp.baileys.service.ts`](https://github.com/lolotam/evolution-api/blob/f1100ad8741fb8af5015fc86b11e78e95d50c353/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts) textMessage at 2629 and sendMessageWithTyping at 2289 send the message, prepareMessage at 4652 preserves its `key`, and the handler returns messageRaw.

A sanitized synthetic accepted shape is `{key:{id:"synthetic-id",fromMe:true,remoteJid:"99900000001@s.whatsapp.net"}}`, with HTTP 201. A valid bounded message ID and self-sent key are required; a present destination must match. Extra message/session/native envelope fields are dropped. A native instanceId is an internal ID, not proof of the name `romani`; fixed route and scoped key bind authority. Provider acceptance is not recipient delivery/read evidence.

## Uncertainty and safe failure classification

The native method can send before database persistence, webhooks or later code
fails; its broad catch then throws BadRequestException. Therefore arbitrary 400
is **not** proof that no message was sent. Unknown HTTP status/body, redirects,
timeouts, connection resets after handoff, malformed/oversized success, missing ID
or contradictory identity remain `unknown` and cannot be retried automatically.

401/403 from the pinned pre-handler guard are permanent authorization failures,
not automatic retries. A transport connection refusal or DNS failure before any
HTTP connection can be safely retried with bounded backoff. No general 429/5xx
pre-send guarantee was established; those remain uncertain. A disconnected or
unknown status defers a pending job without consuming a send attempt.

The application uses a 15-second send timeout, refuses redirects, caps response at
64 KiB and logs no raw response/body/header/error cause. Local proof uses only a
loopback fake with synthetic destinations. The native session may perform its
own number lookup and save sent messages depending on provider configuration;
application isolation is not an account-level send-only permission. Native
verbose message logging is a separate shared-service operational boundary;
Q8 logging verification was accepted separately from the Curemed operator receipt
SHA256 `262fd084465a61b891ab219f7178cf5caf9d332dcbbbeed3d3c381d7434dd813`.
That receipt does not authorize sends or establish native query-override isolation.
Holder pairing, webhook activation and live sending retain their separate gates.

## Inspected file SHA256 receipts

| File | SHA256 |
| --- | --- |
| sendMessage.router.ts | `80dc29951930cb648e6b141e74bef999914a74d8469da3b1cf4ae0b5e8fc7874` |
| sendMessage.controller.ts | `8962b5b78cef1e6fe5693f271cb0e510a6e2c03047a063c8a23af7b77c8ada00` |
| sendMessage.dto.ts | `01fe5b32f098acb1e72b9a1fcc21e8d0030353e5922625363310df51ed86da70` |
| message.schema.ts | `5b3b4187d2133b43062e1235ccccdf0e7acd84b345872533bb1d7cd1b035a594` |
| whatsapp.baileys.service.ts | `d920d4fdd3cae90cb0369ad501774388388f28475135562f6977628efa913d0c` |
| auth.guard.ts | `31bca7e470cef64156c5f56b4d86c370e2bed651943030c1296e4fab6d20d933` |
