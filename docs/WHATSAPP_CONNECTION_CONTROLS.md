# Admin connection controls

This feature is stacked on the reminder implementation and is not a production
deployment receipt. The owner requested account switching and automatic status
after scanning; the currently linked account is the owner's test account, not
evidence of Romani's final production sender identity.

An authenticated admin can explicitly confirm disconnecting the project account.
The backend disables WhatsApp reminders before a serialized logout, retains audit
and recipient configuration, and uses only the server-configured scoped instance.
No instance deletion/provisioning, master-key fallback, message or chat access is
added. Reconnect requires an explicit QR action and holder scan; sending remains
disabled until deliberate administrator re-enable.

Pinned custom Evolution source remains
`f1100ad8741fb8af5015fc86b11e78e95d50c353`. Source routes/controller establish
`DELETE /instance/logout/:instanceName`, HTTP200 and
`{status:'SUCCESS',error:false,response:{message:'Instance logged out'}}`.
The adapter also reads actual connection state after acknowledgement and reports
disconnect_pending rather than success unless state is closed. It never calls
`/instance/delete`. Native query-override isolation is not waived; browser inputs
cannot supply route/query/instance authority. Logout and connect share a mutation
lock, with separate rate limits so successful logout permits immediate new QR.

The browser polls the admin status GET every3seconds during visible pairing for
a bounded period. No polling action generates QR or sends a message. Actual
connected state clears QR and displays a green check/Connected control. Hidden
pages discard QR and skip background checks; transient QR bytes are held only in
the QR state, not duplicated into connection-status state or persisted. User/
operation generation guards discard late responses. Disconnect confirmation
describes stopping reminders and retaining audit; no real logout is performed
as part of local development tests.

Local backend/API tests use synthetic loopback provider/state only. Browser-host
failures and an owner-active production upload form prevent a live browser proof
in this receipt. No production pairing/logout/send/secret or migration action is
claimed. Release follows the existing exact-head/review/backup/rollback gates,
with PR8's migration/auto-deploy disposition still required first.

## Accepted next notification extension (owner,2026-11-05)

- Attachment permission is per document, defaults OFF, and covers PDF/images.
  Both the opted-in employee's own document and explicitly configured management
  destinations receive the permitted file/caption; company documents remain
  management-only. File attachment is not a new-recipient or resend authority.
- Each employee has independent personal Email and WhatsApp opt-ins, default OFF.
  Personal Email uses that employee's validated email and own documents/residency;
  management email reports continue independently. WhatsApp uses the existing
  validated international mobile, without fallback to legacy phone.
- Existing global email and WhatsApp channel controls remain effective. Sender
  connection does not activate delivery. This extension needs an additive local
  migration after007 and pinned media-send contract/tests; no production migration
  or first live send is authorized merely by recording these requirements.
- The owner plans to add one company and one employee document expiring today.
  These are owner-created records, not a manager-created production fixture or
  an instruction to bypass the existing cron cadence/activation/isolation gates.
