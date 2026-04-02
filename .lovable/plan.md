

# Replace SMTP/EmailJS with Resend + Daily Cron for Expiry Reminders

## Overview
Remove the current EmailJS/SMTP email system and replace it with Resend API via an Edge Function. Add a daily cron job (pg_cron) that checks all document and residency expiry dates and sends a daily report email.

## Prerequisites
1. **Connect Resend** — Use the Resend connector to link your API key to the project
2. **Lovable Cloud** must be enabled for Edge Functions and pg_cron

## Step 1: Connect Resend Connector
Use `standard_connectors--connect` with connector_id `resend` to set up your Resend API key. This makes `RESEND_API_KEY` and `LOVABLE_API_KEY` available as environment variables.

## Step 2: Create Edge Function `send-expiry-report`
**File**: `supabase/functions/send-expiry-report/index.ts`

This Edge Function will:
- Query Supabase for all employees (check `residency_expiry_date`) and all documents (check `expiry_date`)
- Filter items expiring within 30 days or already expired
- Build an HTML report with:
  - Summary stats (total expiring, expired, critical)
  - Table of expiring employee residencies (name, civil ID, expiry date, days remaining, status)
  - Table of expiring documents (document name, employee name, expiry date, days remaining, status)
  - Table of expiring company documents
- Send the report via the Resend connector gateway (`https://connector-gateway.lovable.dev/resend/emails`)
- Send to a configured recipient email (stored in a `settings` table or passed as parameter)

## Step 3: Create pg_cron Job (Daily at 8 AM)
Create a migration that sets up a pg_cron job calling the Edge Function once daily:
```sql
SELECT cron.schedule(
  'daily-expiry-check',
  '0 8 * * *',
  $$ SELECT net.http_post(...) $$
);
```
This uses `pg_net` to invoke the Edge Function on schedule.

## Step 4: Update `src/lib/emailService.ts`
- Remove `@emailjs/browser` dependency entirely
- Keep the expiry calculation utility functions (`getExpiringEmployees`, `getExpiringDocuments`, `calculateDaysUntilExpiry`, `ExpiryData` interface)
- Replace all `emailjs.send()` calls with `supabase.functions.invoke('send-expiry-report', { body: {...} })`
- Remove SMTP/EmailJS constants and initialization

## Step 5: Update Email Settings UI
**Files**: `src/components/settings/EmailSettings.tsx`, `src/components/settings/types.ts`, `src/pages/Settings.tsx`

- Remove SMTP fields (server, port, username, password, sender)
- Replace with simple fields:
  - **Resend sender email** (from address, e.g., `reports@yourdomain.com`)
  - **Recipient email** (who receives the daily report)
  - **Enable daily notifications** toggle
- Keep the "Check Expiry" and "Send Immediate Report" buttons (these invoke the Edge Function on-demand)
- Keep the expiry monitoring cards and tables as-is
- Update `EmailSettingsData` type to remove SMTP fields, add `resend_from_email`

## Step 6: Remove `@emailjs/browser` Dependency
Uninstall the package since it's fully replaced by Resend.

## Files Modified
1. `supabase/functions/send-expiry-report/index.ts` — **NEW** Edge Function
2. `supabase/migrations/XXXX_daily_expiry_cron.sql` — **NEW** pg_cron migration
3. `src/lib/emailService.ts` — Rewrite: remove EmailJS, keep utilities, add Resend invoke
4. `src/components/settings/EmailSettings.tsx` — Remove SMTP fields, simplify UI
5. `src/components/settings/types.ts` — Update `EmailSettingsData` interface
6. `src/pages/Settings.tsx` — Update email settings state and handlers
7. `package.json` — Remove `@emailjs/browser`

## How It Works
- **Daily**: pg_cron triggers at 8 AM → calls `send-expiry-report` Edge Function → queries DB → builds HTML report → sends via Resend gateway
- **On-demand**: User clicks "Send Report" in Settings → same Edge Function is invoked → report sent immediately
- **Report content**: Employee residency expiry + employee documents expiry + company documents expiry, all within 30 days or already expired

