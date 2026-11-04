import type { Db } from '../db/connection.js';
import { WhatsAppReminders } from '../notifications/whatsapp/service.js';
import { reminderOrigin, type PairingConfig } from './config.js';
import { MessageClient } from './messageClient.js';

/** Invalid local configuration cannot admit outbox work; audit remains separately readable. */
export function createReminderRuntime(db: Db, config: PairingConfig): WhatsAppReminders {
  return new WhatsAppReminders(db, reminderOrigin(config) ? 'romani' : '', new MessageClient(config));
}
