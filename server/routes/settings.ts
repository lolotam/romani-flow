import { Router } from 'express';
import cron from 'node-cron';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, tenantOf } from '../middleware/auth.js';
import {
  readAllSettings,
  type SettingValue,
} from '../repositories/settings.js';
import type { ExtractionService } from '../extraction/service.js';
import type { CandidateValidation } from '../extraction/candidates.js';
import { NOTIFICATION_INTERVALS } from '../services/intervals.js';
import { mayChangeSchedule, type CronService } from '../services/cronService.js';
import type { WhatsAppReminders } from '../notifications/whatsapp/service.js';

/**
 * Settings endpoints.
 *
 * Only the operational keys the administrator may change are writable, and each
 * one is validated strictly. A request with an invalid value is rejected whole —
 * a half-written configuration would silently disable the reminders.
 *
 * The SMTP credentials and the JWT secret live in the environment and are never
 * stored here.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Rule {
  validate: (value: unknown) => SettingValue | null;
  message: string;
}

function boolRule(): Rule {
  return {
    validate: (value) => (typeof value === 'boolean' ? value : null),
    message: 'must be true or false',
  };
}

function numberRule(min: number, max: number): Rule {
  return {
    validate: (value) => {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
      return parsed;
    },
    message: `must be a number between ${min} and ${max}`,
  };
}

function stringRule(maxLength: number): Rule {
  return {
    validate: (value) =>
      typeof value === 'string' && value.length <= maxLength ? value : null,
    message: `must be a string of at most ${maxLength} characters`,
  };
}

function emailListRule(): Rule {
  return {
    validate: (value) => {
      if (!Array.isArray(value)) return null;
      const items = value.map((entry) => String(entry).trim()).filter(Boolean);
      if (!items.every((entry) => EMAIL_PATTERN.test(entry))) return null;
      return items;
    },
    message: 'must be a list of valid email addresses',
  };
}

function intervalRule(): Rule {
  return {
    validate: (value) => {
      if (!Array.isArray(value)) return null;
      const items = value.map((entry) => Number.parseInt(String(entry), 10));
      if (!items.every((item) => (NOTIFICATION_INTERVALS as readonly number[]).includes(item))) {
        return null;
      }
      return [...new Set(items)].map(String);
    },
    message: `must be a combination of ${NOTIFICATION_INTERVALS.join(', ')}`,
  };
}

function languageRule(): Rule {
  return {
    validate: (value) => (value === 'ar' || value === 'en' ? value : null),
    message: "must be 'ar' or 'en'",
  };
}

/** The provider of an extraction is one of the two supported ones, or none. */
function providerRule(): Rule {
  return {
    validate: (value) => (value === '' || value === 'groq' || value === 'openrouter' ? value : null),
    message: "must be '', 'groq' or 'openrouter'",
  };
}

/** The model of an extraction is an empty value or one model identifier. */
function modelRule(): Rule {
  return {
    validate: (value) =>
      typeof value === 'string' &&
      value.length <= 128 &&
      (value === '' || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+$/.test(value))
        ? value
        : null,
    message: 'must be empty or a model identifier of at most 128 characters',
  };
}

function cronRule(): Rule {
  return {
    validate: (value) => {
      if (typeof value !== 'string') return null;
      const expression = value.trim();
      if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(expression)) return null;
      return cron.validate(expression) ? expression : null;
    },
    message: 'must be a valid five-field cron expression',
  };
}

const EDITABLE: Record<string, Rule> = {
  'whatsapp.enabled': boolRule(),
  'whatsapp.language': languageRule(),
  'email.enabled': boolRule(),
  'email.recipients': emailListRule(),
  'email.cc': emailListRule(),
  'email.from_name': stringRule(100),
  'email.language': languageRule(),
  'email.notification_intervals': intervalRule(),
  'expiry_warning_days': numberRule(1, 365),
  'cron.enabled': boolRule(),
  'cron.schedule': cronRule(),
  'cron.days': numberRule(1, 365),
  'cron.include_employees': boolRule(),
  'cron.include_documents': boolRule(),
  'ai_extraction.enabled': boolRule(),
  'ai_extraction.provider': providerRule(),
  'ai_extraction.model': modelRule(),
};

/**
 * The preferences of the extraction a validated selection is bound to.
 *
 * The enabled flag, the provider and the model are the three settings that
 * decide what an extraction would do. A validation proves them against the
 * live provider, so the values the validation saw have to be the values that
 * are written.
 */
const EXTRACTION_PREFERENCES = [
  'ai_extraction.enabled',
  'ai_extraction.provider',
  'ai_extraction.model',
] as const;

/**
 * Reads the persisted preferences of the extraction.
 *
 * The values are read as they are stored and compared by value, never by the
 * moment of the write: a request that repeats the current selection writes
 * the same values and is therefore not a change, while a request that meets
 * different values was validated against another selection.
 */
function extractionPreferences(settings: Record<string, SettingValue>): string {
  return JSON.stringify(EXTRACTION_PREFERENCES.map(key => settings[key] ?? null));
}

/**
 * Checks the effective extraction selection before anything is written.
 *
 * The combination of the current settings and the requested ones has to be
 * usable: a disabled selection is always allowed, but an enabled selection
 * needs a provider, a model the server offers, a configured key and the
 * processing approval of the environment. The enabled selection is proved
 * against the fresh metadata of the provider as well, so a revoked or a paid
 * candidate is refused before a single setting is written. The check never
 * changes a setting and never activates anything on its own.
 *
 * The request keeps the requested candidate immutable and hands the authority
 * of that candidate back, so the caller can read the authority again right
 * before it writes.
 */
async function validateExtractionSelection(
  config: AppConfig,
  effective: Record<string, SettingValue>,
  extraction: ExtractionService,
  userId: string,
): Promise<CandidateValidation> {
  if (effective['ai_extraction.enabled'] !== true) {
    return { problem: null, authority: null };
  }

  const provider = String(effective['ai_extraction.provider'] ?? '');
  const model = String(effective['ai_extraction.model'] ?? '');
  if (!provider || !model) {
    return { problem: 'Enabling the extraction needs a provider and a model.', authority: null };
  }
  if (provider !== 'groq' && provider !== 'openrouter') {
    return { problem: 'The selected provider is not known.', authority: null };
  }
  if (!config.extraction.authorized) {
    return { problem: 'External document processing is not authorized.', authority: null };
  }
  return extraction.validateCandidate({
    userId,
    provider,
    model,
    context: config.extraction.context,
  });
}

/**
 * A refusal of the settings write at its real boundary.
 *
 * The write of the reminders is the moment the database changes, so the
 * authority of a selection has to hold there. The refusal carries the reason
 * the caller reports, and it never leaves a partially written configuration
 * behind.
 */
/**
 * Keys a workspace may not change in P1 (decision D11).
 *
 * The schedule is one platform setting that only the legacy workspace edits until
 * the platform dashboard exists (the caller drops an unchanged schedule first).
 * WhatsApp settings exist only for the workspace that owns the instance (D9).
 */
function workspaceRestriction(workspaceId: string, reminderWorkspaceId: string, key: string): string | null {
  if (key === 'cron.schedule' && !mayChangeSchedule({ workspaceId })) {
    return 'The reminder schedule is managed by the platform.';
  }
  if (key.startsWith('whatsapp.') && workspaceId !== reminderWorkspaceId) {
    return 'WhatsApp reminders are not available for this workspace.';
  }
  return null;
}

class SettingsWriteRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SettingsWriteRefused';
  }
}

export function createSettingsRouter(
  config: AppConfig,
  db: Db,
  cron: CronService,
  reminders: WhatsAppReminders,
  extraction: ExtractionService,
): Router {
  const router = Router();

  // The settings reveal the relay of the workspace, so only an owner reads them.
  router.get('/', requireAdmin, (req, res) => {
    res.json({
      data: {
        settings: readAllSettings(db, tenantOf(req)),
        smtp: {
          configured: Boolean(config.smtp.host && config.smtp.user && config.smtp.pass),
          host: config.smtp.host,
          port: config.smtp.port,
          user: config.smtp.user,
          secure: config.smtp.secure,
          from: config.smtp.from,
        },
      },
      error: null,
    });
  });

  router.put(
    '/',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = (req.body?.settings ?? req.body ?? {}) as Record<string, unknown>;
      const scope = tenantOf(req);

      const accepted: Record<string, SettingValue> = {};
      const rejected: Array<{ key: string; reason: string }> = [];

      for (const [key, rawValue] of Object.entries(body)) {
        const rule = EDITABLE[key];

        if (!rule) {
          rejected.push({
            key,
            reason: key.startsWith('cron.last_')
              ? 'This field is written by the scheduler and cannot be set.'
              : 'This setting is not editable.',
          });
          continue;
        }

        const value = rule.validate(rawValue);
        if (value === null) {
          rejected.push({ key, reason: rule.message });
          continue;
        }

        if (key === 'cron.schedule' && value === cron.currentSchedule()) continue;
        const unavailable = workspaceRestriction(scope.workspaceId, reminders.scope.workspaceId, key);
        if (unavailable) {
          rejected.push({ key, reason: unavailable });
          continue;
        }

        accepted[key] = value;
      }

      // A partially applied configuration is worse than a rejected one.
      if (rejected.length > 0) {
        res.status(400).json({
          data: null,
          error: {
            message: 'The settings were not saved because some values are not valid.',
            code: 'invalid_settings',
            rejected,
          },
        });
        return;
      }

      // The effective combination is checked before the first write, so a
      // rejected request changes neither a setting nor a notification.
      const persisted = readAllSettings(db, scope);
      const effective = { ...persisted, ...accepted };
      const changesExtraction = Object.keys(accepted).some(key => key.startsWith('ai_extraction.'));
      // The persisted preferences are observed before the validation and the
      // validated selection is bound to exactly these values. A write that
      // finds different values was proved against another selection.
      const boundPreferences = extractionPreferences(persisted);
      const validation = changesExtraction
        ? await validateExtractionSelection(config, effective, extraction, req.user!.id)
        : { problem: null, authority: null };
      if (validation.problem) {
        res.status(400).json({
          data: null,
          error: {
            message: 'The settings were not saved because the extraction selection is not valid.',
            code: 'invalid_settings',
            rejected: [{ key: 'ai_extraction.enabled', reason: validation.problem }],
          },
        });
        return;
      }

      // The authority of the selection is read again before the first write.
      // A role, a context or an approval that changed while the remote proof
      // was pending refuses the whole request, so a mixed request never
      // writes half of its settings.
      const authority = validation.authority;
      if (authority) {
        const refused = extraction.assertCandidateAuthority(authority);
        if (refused) {
          res.status(400).json({
            data: null,
            error: {
              message: 'The settings were not saved because the extraction selection is not valid.',
              code: 'invalid_settings',
              rejected: [{ key: 'ai_extraction.enabled', reason: refused }],
            },
          });
          return;
        }
      }

      // The same authority is proved again at the real write boundary, and the
      // persisted preferences are read again with it. The assertion runs inside
      // the coordinator of the reminders, after every await and directly
      // before the settings are applied, so a role, a context or an approval
      // that changed while the write was queued or while the enable check was
      // pending refuses the whole request before a single setting, notification
      // or job changes.
      //
      // The preferences are compared by value, so a queued request that
      // repeats the current selection still succeeds, and a request that was
      // validated against another selection — including a partial write that
      // changed only the enabled flag — is refused as a whole.
      const beforeWrite = changesExtraction
        ? () => {
            const changed = extractionPreferences(readAllSettings(db, scope)) !== boundPreferences;
            const refused = changed
              ? 'The extraction selection changed while it was validated.'
              : authority
                ? extraction.assertCandidateAuthority(authority)
                : null;
            if (refused) throw new SettingsWriteRefused(refused);
          }
        : undefined;

      try {
        await reminders.saveSettings(scope, accepted, beforeWrite);
      } catch (error) {
        if (!(error instanceof SettingsWriteRefused)) throw error;
        res.status(400).json({
          data: null,
          error: {
            message: 'The settings were not saved because the extraction selection is not valid.',
            code: 'invalid_settings',
            rejected: [{ key: 'ai_extraction.enabled', reason: error.reason }],
          },
        });
        return;
      }
      cron.reschedule();

      res.json({ data: { updated: Object.keys(accepted), rejected: [] }, error: null });
    }),
  );

  return router;
}
