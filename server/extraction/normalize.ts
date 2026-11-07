import {
  calendarDate,
  type CatalogEntry,
  type Catalogs,
  type ExtractionResult,
  type RawPage,
} from '../contracts/documentExtraction.js';
import { documentNumber } from '../contracts/documentNumber.js';

/**
 * Conservative reconciliation of raw provider pages.
 *
 * The provider output is untrusted, so every page has to take part in the
 * decision and every proposal has to be justified before it may be applied:
 *
 *   - the pages must be exactly the pages 1..count, without a gap, a duplicate
 *     or a surplus, otherwise the whole extraction fails;
 *   - a single uncertain or invalid proposal blocks the automatic application
 *     of that field, even when another page is clear;
 *   - two clear but different values conflict and stay unresolved;
 *   - a field nobody proposed is simply missing.
 *
 * Nothing is invented here. A value either comes from a page, matches an
 * existing catalog entry, or is left for a human to review.
 */

/** One normalized field proposal. */
type Candidate = ExtractionResult['fields']['title'];

/** The raw proposal shape shared by every field. */
interface RawField {
  value: string | null;
  certainty: 'clear' | 'uncertain' | 'missing';
}

/** The maximum length of a title. */
const MAX_TITLE_LENGTH = 120;

/**
 * Removes the characters that must never be displayed.
 *
 * The alternatives are plain text for a human to review, so the control
 * characters are dropped instead of being rendered.
 */
function stripControlCharacters(value: string): string {
  return [...value]
    .filter(character => {
      const code = character.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
}

/**
 * Resolves a label to an existing catalog entry.
 *
 * The match is exact after normalization, in English or in Arabic, and it
 * resolves to a single existing id. An unknown or ambiguous label resolves to
 * nothing: no id is invented and no fuzzy entry is guessed.
 */
export function matchCatalog(label: string, rows: CatalogEntry[]): string | null {
  const key = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase('en-US');
  const ids = new Set(
    rows
      .filter(row => [row.name, row.name_ar].some(name => key(name) === key(label)))
      .map(row => row.id),
  );
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * Reconciles the proposals of one field across all pages.
 *
 * The normalization function turns a raw value into its accepted form, or into
 * `null` when the value may not be applied. The failure reason distinguishes an
 * unusable value from an unusable catalog label.
 */
function decide(
  values: RawField[],
  normalize: (value: string, index: number) => string | null,
  failure: Candidate['reason'] = 'invalid',
): Candidate {
  const normalized: string[] = [];
  const alternatives: string[] = [];
  let reason: Candidate['reason'] = 'none';

  values.forEach((item, index) => {
    const value = item.value?.trim() ?? '';
    if (value) alternatives.push(stripControlCharacters(value).slice(0, 128));
    if (item.certainty === 'missing' && !value) return;
    if (item.certainty !== 'clear') {
      reason = 'uncertain';
      return;
    }
    const result = value ? normalize(value, index) : null;
    if (result === null) {
      reason = failure;
      return;
    }
    normalized.push(result);
  });

  const unique = [...new Set(normalized)];
  if (unique.length > 1) reason = 'conflict';
  if (reason !== 'none') {
    return { value: null, state: 'review', alternatives: [...new Set(alternatives)].slice(0, 10), reason };
  }
  if (unique.length === 0) return { value: null, state: 'missing', alternatives: [], reason: 'none' };
  return { value: unique[0], state: 'clear', alternatives: [], reason: 'none' };
}

/**
 * Normalizes every page of one extraction response.
 *
 * Every page participates: a page set that is not exactly 1..count fails the
 * extraction instead of returning a subset. The dates are accepted only as
 * explicit ISO Gregorian dates whose raw source is the very same string, so no
 * calendar is converted and no component is filled in.
 */
export function normalizePages(
  pages: RawPage[],
  count: number,
  catalogs: Catalogs,
): ExtractionResult['fields'] {
  const ordered = [...pages].sort((a, b) => a.page - b.page);
  if (
    count < 1 ||
    count > 10 ||
    ordered.length !== count ||
    ordered.some((page, index) => page.page !== index + 1)
  ) {
    throw new Error('incomplete_pages');
  }

  const date = (field: 'issue_date' | 'expiry_date') =>
    decide(
      ordered.map(page => page[field]),
      (value, index) => {
        const raw = ordered[index][field];
        return raw.calendar === 'gregorian' && raw.source?.trim() === value ? calendarDate(value) : null;
      },
    );

  const fields: ExtractionResult['fields'] = {
    title: decide(
      ordered.map(page => page.title),
      value => (value.length <= MAX_TITLE_LENGTH ? value : null),
    ),
    document_number: decide(ordered.map(page => page.document_number), value => {
      const result = documentNumber.safeParse(value);
      return result.success ? result.data : null;
    }),
    document_type_id: decide(
      ordered.map(page => page.document_type_label),
      value => matchCatalog(value, catalogs.types),
      'catalog',
    ),
    ministry_id: decide(
      ordered.map(page => page.ministry_label),
      value => matchCatalog(value, catalogs.ministries),
      'catalog',
    ),
    issue_date: date('issue_date'),
    expiry_date: date('expiry_date'),
  };

  const issue = fields.issue_date.value;
  const expiry = fields.expiry_date.value;
  if (issue && expiry && expiry < issue) {
    fields.issue_date = { value: null, state: 'review', alternatives: [issue], reason: 'conflict' };
    fields.expiry_date = { value: null, state: 'review', alternatives: [expiry], reason: 'conflict' };
  }

  return fields;
}
