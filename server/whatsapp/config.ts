/** Only the Romani backend owns these values; no shared master-key fallback. */
export interface PairingConfig {
  url: string;
  apiKey: string;
  instance: string;
  webhookSecret: string;
  serverApiKey?: string;
}

export function readPairingConfig(env: NodeJS.ProcessEnv): PairingConfig {
  return {
    url: env.ROMANI_EVOLUTION_URL?.trim() ?? '',
    apiKey: env.ROMANI_EVOLUTION_API_KEY?.trim() ?? '',
    instance: env.ROMANI_EVOLUTION_INSTANCE?.trim() ?? '',
    webhookSecret: env.ROMANI_EVOLUTION_WEBHOOK_SECRET?.trim() ?? '',
    serverApiKey: env.ROMANI_EVOLUTION_API_KEY?.trim() ?? '',
  };
}

export function pairingConfiguration(config: PairingConfig): 'absent' | 'valid' | 'invalid' {
  if (!config.url && !config.apiKey) return 'absent';
  if (!Object.values(config).some(Boolean)) return 'absent';
  try {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return 'invalid';
    if (!/^(?:romani|rf_[a-zA-Z0-9_-]+)(?:[-_][a-z0-9]+)*$/.test(config.instance)) return 'invalid';
    if (config.apiKey.length < 16 || config.webhookSecret.length < 32 || config.apiKey === config.webhookSecret) return 'invalid';
    return 'valid';
  } catch {
    return 'invalid';
  }
}

/** One environment variable that blocks the pairing, named but never valued. */
export interface PairingConfigurationIssue {
  variable: string;
  problem: 'missing' | 'invalid';
}

/**
 * The variables that keep the pairing from working.
 *
 * The operator sees one unusable panel and no way to tell which setting is
 * wrong. Only the name of the variable and whether it is missing or malformed
 * is reported, so a secret never leaves the server.
 */
export function pairingConfigurationIssues(config: PairingConfig): PairingConfigurationIssue[] {
  const issues: PairingConfigurationIssue[] = [];
  if (!config.url) issues.push({ variable: 'ROMANI_EVOLUTION_URL', problem: 'missing' });
  else if (!isPairingUrl(config.url)) issues.push({ variable: 'ROMANI_EVOLUTION_URL', problem: 'invalid' });

  if (!config.instance) issues.push({ variable: 'ROMANI_EVOLUTION_INSTANCE', problem: 'missing' });
  else if (!/^(?:romani|rf_[a-zA-Z0-9_-]+)(?:[-_][a-z0-9]+)*$/.test(config.instance)) {
    issues.push({ variable: 'ROMANI_EVOLUTION_INSTANCE', problem: 'invalid' });
  }

  if (!config.apiKey) issues.push({ variable: 'ROMANI_EVOLUTION_API_KEY', problem: 'missing' });
  else if (config.apiKey.length < 16) issues.push({ variable: 'ROMANI_EVOLUTION_API_KEY', problem: 'invalid' });

  if (!config.webhookSecret) issues.push({ variable: 'ROMANI_EVOLUTION_WEBHOOK_SECRET', problem: 'missing' });
  else if (config.webhookSecret.length < 32 || config.webhookSecret === config.apiKey) {
    issues.push({ variable: 'ROMANI_EVOLUTION_WEBHOOK_SECRET', problem: 'invalid' });
  }

  return issues;
}

function isPairingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Sending is bound to the reviewed origin; pairing fixtures may use broader configuration. */
export function reminderOrigin(config: PairingConfig): string | null {
  if (pairingConfiguration(config) !== 'valid') return null;
  if (config.instance !== 'romani' && config.instance !== 'romani-fixture' && !config.instance.startsWith('rf_')) return null;
  const origin = new URL(config.url).origin;
  return config.url.replace(/\/+$/, '') === origin ? origin : null;
}
