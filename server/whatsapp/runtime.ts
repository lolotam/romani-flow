import type { Db } from '../db/connection.js';
import type { Scope } from '../repositories/base.js';
import { WhatsAppReminders } from '../notifications/whatsapp/service.js';
import { reminderOrigin, type PairingConfig } from './config.js';
import { MessageClient } from './messageClient.js';
import { getWorkspaceApiKey } from './instance.js';

/** Invalid local configuration cannot admit outbox work; audit remains separately readable. */
export function createReminderRuntime(db: Db, config: PairingConfig): WhatsAppReminders {
  const origin = reminderOrigin(config);
  const factory = (inst: string, scope?: Scope) => {
    const wsId = scope?.workspaceId;
    const apiKey = wsId ? getWorkspaceApiKey(db, wsId, config.apiKey) : config.apiKey;
    return new MessageClient({ ...config, instance: inst, apiKey });
  };
  const rootInstance = origin ? (config.instance || 'romani') : '';
  return new WhatsAppReminders(
    db,
    rootInstance,
    factory(rootInstance),
    undefined,
    undefined,
    factory,
  );
}
