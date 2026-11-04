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
