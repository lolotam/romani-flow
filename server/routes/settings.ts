import { Router } from 'express';
import cron from 'node-cron';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  readAllSettings,
  setSettings,
  type SettingValue,
} from '../repositories/settings.js';
import { NOTIFICATION_INTERVALS } from '../services/intervals.js';
import type { CronService } from '../services/cronService.js';
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
};

export function createSettingsRouter(config: AppConfig, db: Db, cron: CronService, reminders: WhatsAppReminders): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      data: {
        settings: readAllSettings(db),
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

      if (accepted['whatsapp.enabled'] === true) {
        await reminders.assertCanEnable();
      }
      await reminders.mutate(() => setSettings(db, accepted));
      cron.reschedule();

      res.json({ data: { updated: Object.keys(accepted), rejected: [] }, error: null });
    }),
  );

  return router;
}
