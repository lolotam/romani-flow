import type { Db } from '../db/connection.js';
import { WhatsAppReminders } from '../notifications/whatsapp/service.js';
import { reminderOrigin, type PairingConfig } from './config.js';
import { MessageClient } from './messageClient.js';

/** Invalid local configuration must not own an outbox namespace after restart. */
export function createReminderRuntime(db: Db, config: PairingConfig): WhatsAppReminders {
  return new WhatsAppReminders(db, reminderOrigin(config) ? 'romani' : '', new MessageClient(config));
}
