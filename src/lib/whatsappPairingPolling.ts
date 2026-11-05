import { ApiRequestError } from './api/http';

/** Only a temporary transport/provider outage may preserve a pending pairing. */
export function isTransientPairingReadError(error: unknown): boolean {
  return error instanceof ApiRequestError && (
    (error.status === 0 && error.code === 'network_error') ||
    (error.status >= 500 && error.code === 'provider_unavailable')
  );
}

/** The caller owns one absolute deadline; QR expiry/visibility cannot extend it. */
export function startPairingStatusPolling(until: number, poll: () => void, visible: () => boolean) {
  let active = Date.now() < until;
  const check = () => { if (active && Date.now() < until && visible()) poll(); };
  const interval = globalThis.setInterval(check, 3000);
  const stop = () => {
    active = false;
    globalThis.clearInterval(interval);
    globalThis.clearTimeout(timeout);
  };
  const timeout = globalThis.setTimeout(stop, Math.max(0, until - Date.now()));
  return { check, stop };
}
