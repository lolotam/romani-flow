

# Implement Resend Email System — Full Implementation Plan

## Overview
Replace the current EmailJS-based email system with Resend API via a Supabase Edge Function. Create a daily cron job for automated expiry checking. Update the UI to remove SMTP fields. The Resend connector will be connected later when the API key is available.

## Step 1: Create Edge Function `send-expiry-report`
**New file**: `supabase/functions/send-expiry-report/index.ts`

This Edge Function will:
- Accept POST requests with optional `recipientEmail` and `senderEmail` parameters
- Create a Supabase client with service role key
- Query `employees` table for records where `residency_expiry_date` is within 30 days or expired
- Query `documents` table for records where `expiry_date` is within 30 days or expired
- Join documents with employees to get employee names
- Build a styled HTML report (RTL Arabic) with:
  - Summary stats (total expiring, expired, critical)
  - Table of expiring employee residencies
  - Table of expiring employee/company documents
- Send via Resend connector gateway (`https://connector-gateway.lovable.dev/resend/emails`) using `RESEND_API_KEY` and `LOVABLE_API_KEY`
- Return success/failure response with CORS headers
- Gracefully handle missing API keys with a clear error message (so the app works before the connector is linked)

## Step 2: Create pg_cron Migration for Daily Trigger
**New file**: `supabase/migrations/XXXX_daily_expiry_cron.sql`

```sql
SELECT cron.schedule(
  'daily-expiry-check',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := '...' || '/functions/v1/send-expiry-report',
    headers := jsonb_build_object(...),
    body := '{}'::jsonb
  )
  $$
);
```

## Step 3: Rewrite `src/lib/emailService.ts`
- Remove `import emailjs` and all EmailJS constants/initialization
- Keep utility functions: `ExpiryData`, `EmailNotificationSettings`, `getExpiringEmployees`, `getExpiringDocuments`, `calculateDaysUntilExpiry`, `generateEmailHTML`
- Replace `sendExpiryNotification` to call `supabase.functions.invoke('send-expiry-report', { body: { recipientEmail, senderEmail } })`
- Replace `checkAndSendNotifications` similarly
- Remove `sendEmployeeExpiryNotification`, `sendCompanyExpiryNotification`, `sendIndividualEmployeeNotifications`, `checkAndSendNotificationsLegacy` (all used EmailJS directly)

## Step 4: Update `src/components/settings/types.ts`
Replace `EmailSettingsData`:
```typescript
export interface EmailSettingsData {
  resend_from_email: string;    // sender address
  email_receiver: string;       // recipient
  enable_notifications: boolean;
  daily_schedule: boolean;      // replaces weekly/monthly
}
```

## Step 5: Update `src/components/settings/EmailSettings.tsx`
- Remove all SMTP fields (server, port, username, password, sender)
- Replace with:
  - Resend sender email input
  - Recipient email input
  - Enable daily notifications toggle
- Keep the expiry monitoring cards, tables, and action buttons as-is

## Step 6: Update `src/pages/Settings.tsx`
- Update `emailSettings` initial state to match new `EmailSettingsData` type
- Update `handleSendTestEmail` to invoke the Edge Function via `supabase.functions.invoke`
- Update `handleAutoNotifications` similarly
- Remove imports of deleted functions from emailService

## Step 7: Remove `@emailjs/browser` Dependency
- Remove from `package.json`

## Files Modified
1. `supabase/functions/send-expiry-report/index.ts` — NEW
2. `supabase/migrations/XXXX_daily_expiry_cron.sql` — NEW
3. `src/lib/emailService.ts` — Rewrite (remove EmailJS, keep utilities, add Edge Function invoke)
4. `src/components/settings/types.ts` — Update interface
5. `src/components/settings/EmailSettings.tsx` — Remove SMTP fields, simplify
6. `src/pages/Settings.tsx` — Update state and handlers
7. `package.json` — Remove `@emailjs/browser`

## Important Notes
- The Edge Function will return a descriptive error if the Resend connector is not yet linked — the app will still build and run
- Once you provide the Resend API key, we will connect it and the system will start sending emails automatically
- The cron job runs daily at 8 AM and requires no manual intervention

