# Password-only sign-up and per-member SMTP — design specification

Status: approved by the owner on 2026-11-13. This is a separate feature from the P3 admin dashboard and P4 per-workspace WhatsApp work. It does not authorize production activation, a production migration, real email sends, or a merge by itself.

Amendment (2026-11-17): the owner decided to merge this feature with the workspace relay that `main` shipped in PR #28. The relay of the workspace stays the default, the relay of a member overrides it for that member alone, and the identity of a member is the account of the native authentication instead of a Clerk identity row. The feature therefore no longer waits for the Clerk switch. Sections that describe the Clerk identity or a member-only relay are read in that light; the activation plan in `docs/ACTIVATION_PLAN.md` governs the order.

## 1. Outcome

A person can create an account and return to it with Email + Password without an email OTP or an account-activation email. Every workspace member can independently configure a personal SMTP account. Manual email is sent through the current member's SMTP account. Scheduled workspace reports use the SMTP account of one member explicitly designated by the workspace owner as the notification sender.

The Settings area includes bilingual, provider-specific setup guidance. SMTP passwords remain server-only, are encrypted at rest, and are never shown to another member, including the workspace owner.

## 2. Owner decisions

| Topic | Decision |
| --- | --- |
| Sign-up and sign-in | Email + Password immediately; no email OTP or activation email. Google sign-in remains available. |
| Ordinary workspaces | Unverified email users may create, join, and use workspaces. |
| Sensitive identity claims | The legacy Romani workspace claim and platform-admin allowlist still require a verified email. An unverified account cannot claim them. |
| SMTP ownership | Each member configures their own email account independently within each workspace. No member can read or use another member's credentials. |
| Manual sending | Uses the currently signed-in member's SMTP configuration. Existing editor/owner permission rules still apply; viewers cannot send documents merely by configuring SMTP. |
| Scheduled sending | The owner designates one member as the workspace notification sender. The cron uses only that member's configuration. |
| Setup help | Settings includes guided Gmail, Outlook, and custom SMTP instructions in Arabic and English. |
| Test email | An explicit action verifies the connection and sends a test only to the current member's own account email. |
| Backup | SMTP passwords and their ciphertext are excluded from exports and backups. Non-secret configuration may be retained. |

## 3. Scope and non-goals

### In scope

- Clerk instance configuration for password-only sign-up and sign-in.
- Per-member SMTP storage, encryption, management, testing, and guided setup.
- Per-member mail transport selection for manual email.
- An owner-selected notification sender for scheduled email.
- Migration, tenant isolation, credential-deletion handling, tests, and rollout documentation.

### Out of scope

- A shared SMTP account for every workspace.
- Sending scheduled reports separately from every member's email account.
- OAuth setup for Gmail or Microsoft accounts.
- Arbitrary sender addresses not authorized by the member's SMTP provider.
- Removing verification requirements from the legacy workspace claim or platform-admin authorization.
- Disabling password-reset emails, organization invitations, or optional MFA chosen by a user.
- Real email delivery during local tests.
- P3 admin dashboard and P4 Evolution instance provisioning, except for reusing the encryption convention defined here.

## 4. Current architecture and required change

The current `Mailer` is a singleton configured from `SMTP_*` environment variables. It creates one Nodemailer transport and uses one `from` address. `EmailConfigCard` currently tells users to place SMTP values in the server environment. Clerk identity resolution already retains `emailVerified`, and sensitive authorization paths use it.

The feature introduces a member-scoped SMTP repository and a transport resolver. Email call sites stop selecting a global transport directly and instead provide the current workspace and acting member, or the designated notification sender for a scheduled run.

## 5. Data model

Add the next available reviewed migration. No existing document, employee, recipient, or workspace content is rewritten.

### `member_smtp_settings`

- `workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`
- `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `host TEXT NOT NULL`
- `port INTEGER NOT NULL`
- `secure INTEGER NOT NULL`
- `username TEXT NOT NULL`
- `password_ciphertext TEXT NOT NULL`
- `sender_address TEXT NOT NULL`
- `sender_name TEXT NULL`
- `last_tested_at TEXT NULL`
- `last_test_status TEXT NULL`
- `last_test_error_code TEXT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- Primary key: `(workspace_id, user_id)`

`password_ciphertext` contains the nonce, authentication tag, and ciphertext of an AES-256-GCM payload. The plaintext password is never stored. The key comes only from the server environment as `APP_ENCRYPTION_KEY`, decoded to exactly 32 bytes. P4 can reuse this convention for Evolution tokens; the two credential types must have separate associated data.

The encryption key is required when a member SMTP secret is written or read. If it is absent or malformed, member-SMTP operations fail closed with `encryption_not_configured`; no plaintext fallback is allowed.

### Workspace notification sender

Add nullable `workspaces.notification_sender_user_id REFERENCES users(id) ON DELETE SET NULL`. The value names the local user whose member SMTP configuration the cron uses. The server validates active organization membership when assigning it and again before a scheduled send. A membership check that cannot be completed fails closed; it never falls back to another member.

When an organization membership is removed, the webhook clears that member's designation and deletes their SMTP configuration for that workspace. When a user is deleted, all their member SMTP rows and every notification-sender designation pointing to them are removed.

## 6. Authentication configuration

Use the existing production Clerk application. Do not create or link a replacement application.

The implementation first discovers the live configuration keys with the Clerk CLI and applies a reviewed configuration change with a dry run:

- Enable email and password.
- Disable email verification code and email verification link for ordinary sign-in and sign-up.
- Disable sign-up email verification so a new password account becomes active immediately.
- Ensure Device Trust does not impose an email OTP challenge on an ordinary password sign-in.
- Keep optional user-selected MFA separate from the default flow.

Acceptance behavior:

1. A new user enters an unused email and a valid password and reaches organization creation/joining without an email code or activation email.
2. The same user signs out and returns with Email + Password without an email code.
3. The unverified user can use an ordinary workspace.
4. The unverified user cannot claim the legacy workspace and receives `403` for platform-admin authorization.
5. A verified Google account can still satisfy those verified-only checks.

No custom OTP flow is added to the application.

## 7. Member SMTP API

All routes use the verified request tenant and acting `userId`. A client-supplied `user_id` or `workspace_id` is ignored or rejected; it never selects another member's configuration.

### `GET /api/me/smtp`

Returns the current member's non-secret configuration, `configured`, `hasPassword`, test status, and safe error code. It never returns `password`, `password_ciphertext`, or an encryption nonce/tag.

### `PUT /api/me/smtp`

Creates or updates the current member's configuration. Host, port, TLS mode, username, sender address, and optional sender name are validated. The password is required on first save. An omitted password on a later update retains the existing ciphertext; an empty password is not a valid first save. The password field is write-only.

### `DELETE /api/me/smtp`

Deletes the current member's configuration. If that member is the notification sender, the designation is cleared in the same transaction. Scheduled sending then reports `notification_sender_not_configured` until the owner selects another configured member.

### `POST /api/me/smtp/test`

Verifies the saved connection and sends a test only to the current member's account email. The recipient cannot be supplied by the client. The response and logs record a safe status and error code, never the password or message content.

### `GET /api/workspace/notification-sender`

Owner only. Returns the current designation and the workspace members eligible for selection, with only local user ID, display name, email, and whether each member has a complete SMTP configuration. No SMTP credentials or host details are returned.

### `PUT /api/workspace/notification-sender`

Owner only. Accepts a local user ID belonging to an active member with a complete SMTP configuration, or `null` to clear the designation. The membership and configuration checks occur in the same server operation.

## 8. Mail transport selection

A new resolver accepts a workspace ID and acting user ID, loads only that pair's row, decrypts the password in memory, and creates a Nodemailer transport with the existing timeouts. Transports are not shared across members or workspaces. No cross-member cache is introduced.

The `from` address is the saved sender address. It must be the SMTP username or a provider-authorized alias. The server does not claim to verify alias ownership itself; provider rejection is returned as a safe send error.

- Manual document email uses `req.tenant.workspaceId` and `req.tenant.userId` and retains existing editor/owner authorization.
- Scheduled email reads `notification_sender_user_id`, confirms the sender remains an active organization member, and uses that member's row.
- Missing manual configuration returns `smtp_not_configured` for the current member.
- Missing scheduled designation returns `notification_sender_not_configured` in the report result and email log.
- Authentication, connection, sender-policy, and send failures map to safe codes: `smtp_auth_failed`, `smtp_connection_failed`, `smtp_sender_rejected`, and `send_failed`.
- One member's or workspace's failure does not block another workspace's scheduled run.

Raw Nodemailer errors, credentials, and SMTP commands are not written to logs or returned to clients.

## 9. Settings and setup guidance

The current environment-only SMTP description is replaced by a member-specific SMTP card. It includes:

- Provider choices: Gmail, Outlook, and Custom SMTP.
- Host, port, TLS/STARTTLS, username, password, sender address, and sender-name fields.
- A password field that is always blank after loading, with text explaining that a saved password is never displayed.
- Configuration and last-test status without secret details.
- Save, delete, and test actions with pending and error states in Arabic and English.

Guidance is visible before configuration and remains available afterward:

### Gmail

1. Enable two-step verification on the Google account.
2. Create an App Password in Google account security, following [Google's App Password guidance](https://support.google.com/accounts/answer/185833).
3. Use `smtp.gmail.com`, port `587`, and STARTTLS.
4. Use the full Gmail address as username and the App Password, not the normal account password.
5. Use the Gmail address or an alias already authorized in the Google account as sender.

### Outlook

1. Confirm SMTP AUTH is enabled for the mailbox and organization, following [Microsoft's client SMTP submission guidance](https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365).
2. Use `smtp.office365.com`, port `587`, and STARTTLS.
3. Use the full mailbox address and the credential accepted by the organization.
4. Explain that tenant security policy may require an administrator to permit SMTP AUTH.

### Custom SMTP

Explain host, port, TLS versus STARTTLS, username, password, and provider-authorized sender address. Link only to verified official provider documentation. Do not include real credentials in examples, screenshots, translations, logs, or tests.

## 10. Privacy, backups, and rate limits

- Workspace exports and backups exclude `password_ciphertext` and plaintext passwords. Non-secret configuration and the notification-sender designation may be exported.
- Restoring a backup requires each member to re-enter their SMTP password.
- Existing recipient validation, attachment limits, and send quotas remain in force.
- SMTP save/test/send endpoints have per-member and per-IP rate limits. Scheduled sends retain workspace quotas and deduplication.
- Platform-admin aggregate responses never include member SMTP configuration, sender addresses, or test results.

## 11. Compatibility and rollout

The existing environment SMTP remains a temporary compatibility path only for the legacy Romani workspace. Once a notification sender is selected there, the member configuration supersedes the environment configuration. Other workspaces cannot use the legacy environment SMTP.

Before production activation:

1. Review and rehearse the migration on a restored backup.
2. Configure `APP_ENCRYPTION_KEY` through the approved secret channel.
3. Verify the Clerk password-only configuration and the non-OTP sign-up/sign-in flow.
4. Confirm the legacy owner has a verified email for the data claim and a member SMTP configuration for scheduled sending.
5. Take a fresh production backup and retain the previous image and migration rollback path.
6. Obtain the separate production merge/activation approval required by the project.

Rollback restores the previous code and environment behavior. The additive member-SMTP table and designation column must not break the previous image.

## 12. Acceptance tests

### Authentication

- Fresh Email + Password sign-up completes without an OTP or activation email.
- Returning password sign-in completes without an OTP, including the configured Device Trust policy.
- Unverified accounts cannot claim the legacy workspace or become platform admin through the email allowlist.
- Verified accounts retain those capabilities.

### Member and tenant isolation

- Members A and B in one workspace cannot read, update, delete, test, or send through each other's SMTP rows.
- The same member can hold different SMTP settings in two workspaces without either configuration leaking into the other.
- A workspace owner can see eligibility status but no member password, ciphertext, or transport. The non-secret configuration of a member (host, port, secure flag, username and sender address) is exportable, as the export rules of this design allow.
- Foreign user/workspace IDs cannot select another member's configuration.
- Membership removal and user deletion clear credentials and notification-sender designations.

### Sending behavior

- Manual email uses the acting member's transport and sender address.
- Cron uses only the designated member and refuses to send if membership cannot be confirmed.
- Missing configuration, deleted credentials, and a cleared designation produce their explicit safe error codes.
- A failure in workspace A does not prevent workspace B from sending.
- No silent fallback to another member occurs.

### SMTP settings and guidance

- First save requires a password; later updates can retain it without returning it.
- Test email goes only to the current member and is triggered explicitly.
- Gmail, Outlook, and Custom guidance renders in Arabic and English with validated provider defaults and official links.
- Responses, browser state, logs, exports, and backups contain no plaintext password or ciphertext.

### Verification method

Use real temporary SQLite databases and a local fake SMTP server. Do not send real email or use production credentials. Run the complete existing suite, new regression suites, lint, typecheck, build, migration rehearsal, and browser checks before any pull request is considered green.
