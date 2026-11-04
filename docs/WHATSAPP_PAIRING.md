# Romani WhatsApp pairing

## Scope and ownership

The owner authorized one existing Contabo Evolution API service with two independent
instances: `curemed` belongs to CuremedKW, `romani` belongs to Romani Flow. Each
website has its own authorized-admin QR/status flow. Sessions, instance tokens and
webhook secrets are not shared. The Curemed manager coordinates infrastructure
and provisioning; Romani does not create/delete/restart/logout another instance.

This release implements **pairing and status only**, not messages or reminders.
The owner has confirmed the current employee mobile with country code, once-only
expired reminders, company documents for management and employee residency in the
broader reminder specification. Reminder implementation/release is separate from
this deployed pairing slice. Goal B's
accepted production release, rollback, KEEP, audit/fixture/data remain preserved.

## Confirmed managed service

Current operator receipt: Contabo `187.77.169.216`, service
`curemedkw-evultionapi-wrtdxe`, ID `mu40grhmcr9arhpejhcjoa9bf`, custom Evolution
2.3.7/source `f1100ad`, image
`sha256:be2cbdefd40b2c10e780b05b812fe7a2291525ada4e2af70af64bfabb7c766a5`.
A narrow exact-ID read independently confirmed health, zero restarts, no published
ports and networks `curemed-evolution-data`, `curemed-evolution-edge`,
`dokploy-network`. The earlier name-filter inventory did not establish API absence.

Romani backend: service `romaniapp-romaniapp-7nuhor` /
`wfzufbe91piu8mc1iyuqagwdi`, port3000, attached only to `dokploy-network`.
No network/service change was made to record this. A later Curemed manager receipt
confirms provisioning with `qrcode:false`, distinct scoped tokens, no pairing,
history or active webhook. Native own status200/foreign status+connect401 and
own-only scoped inventory passed; actual Romani backend also returned own200/
foreign401. These are manager receipts, not SA reruns or website/device proof.

## Backend-only configuration

| Variable | Requirement |
| --- | --- |
| `ROMANI_EVOLUTION_URL` | Approved internal HTTP/HTTPS API base/prefix, no userinfo/query/fragment. |
| `ROMANI_EVOLUTION_API_KEY` | Instance `romani` token, minimum16 characters, never master/Curemed key. |
| `ROMANI_EVOLUTION_INSTANCE` | Exact `romani` in production; code also permits the romani-prefixed namespace for isolated fixtures. |
| `ROMANI_EVOLUTION_WEBHOOK_SECRET` | Independent private random value, minimum32 characters, different from API token. |

Future values are entered by Waleed through `request_secret` or the hub UI; no
values in chat or `VITE_` copies. The manager must not read or copy the provider
private handoff file or rerun file-based configuration helpers.
Leave all four empty to keep pairing unconfigured without affecting email/app boot.
Partial/invalid values fail closed for pairing; no global credential fallback.
Ordinary settings and business exports never contain this configuration.

## Administrator experience and API

Settings → WhatsApp is administrator-only; the API rechecks current database role.

| Route | Contract |
| --- | --- |
| `GET /api/whatsapp/status` | Sanitized fixed-instance state, no QR/key/raw provider/chat fields. |
| `POST /api/whatsapp/connect` | Empty JSON only, QR for fixed instance or already-connected state; no reset/create/send. |
| `POST /api/whatsapp/webhook` | Dedicated provider-secret authentication, not cookie/body API-key authentication. |

Reject query/body project, instance, URL and credential overrides, override headers,
and cross-origin connect requests. Unimplemented instance-addressed actions have
no provider effect. QR/status use `Cache-Control: no-store`; connect is serialized
and limited to one request per15seconds in the single application process.

Production explicitly permits browser Origin `https://romani.curemedkw.com`,
independent of the internal HTTP hop and without trusting forwarded scheme/host.
Other origins, HTTP downgrade, opaque/null and malformed values are rejected.
Development uses the actual request origin; Vite preserves Host for `/api` so
its same-origin proxy works. No alternate production domain is silently trusted.

QR is transient React memory only, PNG-only, hidden on explicit hide/navigation/
page hiding/60seconds. The account holder scans from WhatsApp → Linked devices.
“Check connection” reads the provider; showing QR never invents connection success.
The provider may expire a QR earlier; the owner can request a fresh code.

## Pinned custom2.3.7 contract

Only fixed backend calls are implemented:

- `GET /instance/connectionState/romani`, instance-scoped `apikey` header.
  Require exact returned `instance.instanceName`; map open/close/closed/connecting.
  Missing/unrecognized native state is `unknown`, not connected/disconnected evidence.
  Pairing is disabled/rejected until a known closed/connecting state is obtained;
  uncertainty never triggers a new native connect request.
- `GET /instance/connect/romani` only when not already connected. Native close/
  connecting response is a flat QR object without instanceName; authority comes
  from fixed path plus scoped token, no invented response identity. If identity
  is present, verify it; an already-open nested instance response returns connected.

Redirects are never followed; timeout10seconds, response cap400KB. Only a bounded
PNG data URL with a PNG signature reaches the UI. Provider extra fields/errors and
exception causes are discarded. No discovery/fetchInstances/chats/contacts/history/
message/logout/restart/provisioning method exists. Malformed JSON request errors
are sanitized without logging the original request body.

## Authenticated connection-only webhook

After the reviewed endpoint is deployed AND the shared-service LOG_LEVEL patch
has a verified execution receipt, the shared-service owner configures only
the dedicated Romani instance, preserving Curemed/global configuration:

```json
{
  "webhook": {
    "enabled": true,
    "url": "https://romani.curemedkw.com/api/whatsapp/webhook",
    "headers": { "x-romani-webhook-key": "<secure per-project value>" },
    "events": ["CONNECTION_UPDATE"],
    "byEvents": false,
    "base64": false
  }
}
```

The placeholder is illustrative, never real configuration. Native headers pass
through unchanged; no native HMAC support is claimed. Constant-time dedicated
header comparison precedes exact `body.instance==='romani'`,
`body.event==='connection.update'` and supported-state validation. A body `apikey`
never authenticates. Native apikey/sender/server_url/destination fields are never
logged, stored or forwarded. Incoming message/history events are rejected.
Valid connection events receive202 with no database/provider effect; status stays
an authoritative provider read, not an event cache.

No personal inbox is displayed/imported. This application boundary does not make
a QR-linked Evolution session technically unable to access WhatsApp account data.
Native storage/history policy remains the shared service owner's responsibility.

## Verification and activation gates

`npm run test:whatsapp-pairing` runs real application/session middleware against a
loopback HTTP provider and temporary SQLite. It covers current-role revocation,
foreign JWT, override denial, scoped-key denial, native response shapes/identity,
PNG/redaction, open-session preservation, concurrency/rate-limit, redirects,
oversize/errors, isolated webhooks and secret-free settings/export/parser logs.
These are application/adapter tests, not native Evolution isolation acceptance.

Before release: exact-head typecheck/build/lint/config/forms/operations/API tests,
review-thread pagination and concrete release packet. Pairing adds no SQL migration.
Preserve running rollback image and all existing data; do not down-migrate/wipe.

The native provisioning/denial/connectivity receipt is recorded above. Future
secret entry belongs to Waleed through `request_secret` or the hub UI; do not read
or copy the provider private handoff file or rerun prior file-based helpers.
Deploy the reviewed webhook endpoint and obtain the shared LOG_LEVEL execution
verification receipt before activation. Then proceed one step at a time: real QR
with the account holder, dedicated connection webhook, and scoped smoke test. No customer messages,
bulk/history calls, payment/shipment, Ministry-hold lift, working-key rotation or
shared-session reset is included. Do not equate source auth checks with native
runtime proof or local fake-provider QR with a live WhatsApp QR.
