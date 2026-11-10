import { isRecord } from './http.js';

/**
 * The price classifier of the extraction.
 *
 * A provider states the price of a model as a record of charges. A document may
 * only be sent to a model whose price is *known to be zero*, so the classifier
 * answers one of three questions and never guesses:
 *
 * - `zero`: the required charges and every present optional charge read as zero.
 * - `paid`: at least one valid charge is positive and no field is unresolved.
 * - `unverified`: the record cannot be read, so nothing about it is proven.
 *
 * The catalogue and the activation check share this one classifier, so a model
 * the catalogue calls free can never be activated at a price.
 */

/** The charges every price record has to expose. */
const REQUIRED_CHARGES = ['prompt', 'completion'] as const;

/**
 * The optional charges of the pinned provider price schema.
 *
 * A documented charge may be omitted: a provider that states no image fee
 * states no image fee. A charge the schema does not document is not a price
 * the pipeline can reason about, so it never becomes free.
 */
const OPTIONAL_CHARGES = [
  'audio',
  'audio_output',
  'image',
  'image_output',
  'image_token',
  'input_audio_cache',
  'input_cache_read',
  'input_cache_write',
  'input_cache_write_1h',
  'internal_reasoning',
  'request',
  'web_search',
] as const;

/** Every charge the classifier reads. */
const KNOWN_CHARGES: ReadonlySet<string> = new Set([...REQUIRED_CHARGES, ...OPTIONAL_CHARGES]);

/** A plain decimal amount: no sign, no exponent, no padding, no separator. */
const PLAIN_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** The zero form of a plain decimal amount. */
const ZERO_DECIMAL = /^0(?:\.0+)?$/;

/** What one charge says about the price of the model. */
type ChargeReading = 'zero' | 'positive' | 'unreadable';

/** The verdict of a whole price record. */
export type PricingVerdict = 'zero' | 'paid' | 'unverified';

/**
 * Reads one amount as plain decimal text.
 *
 * The amount stays text: a float would round a tiny positive charge down to
 * zero and turn a paid model into a free one.
 */
function readDecimal(raw: unknown): string | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // A negative zero carries a sign that its own text loses.
    if (Object.is(raw, -0)) return null;
    return readDecimal(String(raw));
  }
  if (typeof raw !== 'string') return null;
  return PLAIN_DECIMAL.test(raw) ? raw : null;
}

/** Reads one charge of a price record. */
function readCharge(raw: unknown): ChargeReading {
  const amount = readDecimal(raw);
  if (amount === null) return 'unreadable';
  return ZERO_DECIMAL.test(amount) ? 'zero' : 'positive';
}

/**
 * Reports whether a discount is a bounded fraction.
 *
 * The schema states a discount as a number between zero and one. A discount is
 * metadata: it never lowers a charge to zero.
 */
function isBoundedDiscount(raw: unknown): boolean {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1;
}

/**
 * Reports whether the price schema applies no override.
 *
 * An override carries its own condition, so the effective price of a record
 * that carries one is not known.
 */
function isEmptyOverrideList(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length === 0;
}

/**
 * Reports whether the metadata fields of a price record are readable.
 *
 * `discount` and `overrides` describe how a price applies, not what it costs.
 */
function hasReadableMetadata(raw: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'discount' && !isBoundedDiscount(value)) return false;
    if (key === 'overrides' && !isEmptyOverrideList(value)) return false;
  }
  return true;
}

/** Reads every charge of a price record. */
function readCharges(raw: Record<string, unknown>): PricingVerdict {
  let paid = false;
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'discount' || key === 'overrides') continue;
    if (!KNOWN_CHARGES.has(key)) return 'unverified';
    const reading = readCharge(value);
    if (reading === 'unreadable') return 'unverified';
    if (reading === 'positive') paid = true;
  }
  return paid ? 'paid' : 'zero';
}

/**
 * Classifies the price of a model.
 *
 * The record is refused as `unverified` whenever it cannot be read: a missing
 * core charge, an unknown charge, a malformed amount, a malformed discount or
 * an override that the schema applies. Nothing that cannot be read is free.
 */
export function classifyPricing(raw: unknown): PricingVerdict {
  if (!isRecord(raw)) return 'unverified';
  if (!REQUIRED_CHARGES.every(charge => Object.hasOwn(raw, charge))) return 'unverified';
  if (!hasReadableMetadata(raw)) return 'unverified';
  return readCharges(raw);
}
