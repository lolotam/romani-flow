/** Only the Romani backend owns these values; no shared master-key fallback. */
export interface PairingConfig {
  url: string;
  apiKey: string;
  instance: string;
  webhookSecret: string;
}

export function readPairingConfig(env: NodeJS.ProcessEnv): PairingConfig {
  return {
    url: env.ROMANI_EVOLUTION_URL?.trim() ?? '',
    apiKey: env.ROMANI_EVOLUTION_API_KEY?.trim() ?? '',
    instance: env.ROMANI_EVOLUTION_INSTANCE?.trim() ?? '',
    webhookSecret: env.ROMANI_EVOLUTION_WEBHOOK_SECRET?.trim() ?? '',
  };
}

export function pairingConfiguration(config: PairingConfig): 'absent' | 'valid' | 'invalid' {
  if (!Object.values(config).some(Boolean)) return 'absent';
  try {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return 'invalid';
    if (!/^romani(?:[-_][a-z0-9]+)*$/.test(config.instance)) return 'invalid';
    if (config.apiKey.length < 16 || config.webhookSecret.length < 32 || config.apiKey === config.webhookSecret) return 'invalid';
    return 'valid';
  } catch {
    return 'invalid';
  }
}

/** Sending is bound to the reviewed literal route; pairing fixtures may use broader configuration. */
export function reminderOrigin(config: PairingConfig): string | null {
  if (pairingConfiguration(config) !== 'valid' || config.instance !== 'romani') return null;
  const origin = new URL(config.url).origin;
  return config.url.replace(/\/+$/, '') === origin ? origin : null;
}
