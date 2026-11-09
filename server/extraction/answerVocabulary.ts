/**
 * The bridge between the vocabulary of a provider and ours.
 *
 * A provider answers in its own words: it writes "certain" where our
 * contract writes "clear", and it writes "Gregorian" where our contract
 * writes "gregorian". The answer is still the answer of the provider, so it
 * is translated and never repaired: a word is translated into the word that
 * carries the same meaning, and a word that names no meaning we know becomes
 * the most careful word we have.
 *
 * The translation changes words and never changes values. A value the
 * provider wrote is copied unchanged, so a document number that was never on
 * the page can never reach a form through this bridge, and a number stays a
 * number, because a number has already lost the leading zeroes and the
 * separators an identifier needs. The translation can never upgrade a field
 * either: an unknown certainty becomes "uncertain" and an unknown calendar
 * becomes "unknown", so a value the provider did not vouch for is never
 * applied to a form automatically.
 *
 * The bridge runs at the trust boundary of the provider, before the strict
 * contract reads the answer. The contract itself stays strict: it still
 * refuses a value that is too long, a page that is missing, a date without
 * its own source, and a number where a text is expected.
 */

/** The certainty words of our contract. */
export type Certainty = 'clear' | 'uncertain' | 'missing';

/** The calendar words of our contract. */
export type Calendar = 'gregorian' | 'unknown';

/**
 * The certainty words a provider may use, and the word of our contract that
 * carries the same meaning.
 *
 * A word that is not listed here becomes "uncertain", which is the state
 * that asks the administrator to confirm the value instead of applying it.
 */
const CERTAINTY_WORDS: Readonly<Record<string, Certainty>> = {
  clear: 'clear',
  certain: 'clear',
  confident: 'clear',
  definite: 'clear',
  exact: 'clear',
  sure: 'clear',
  high: 'clear',
  uncertain: 'uncertain',
  unsure: 'uncertain',
  unclear: 'uncertain',
  ambiguous: 'uncertain',
  probable: 'uncertain',
  possible: 'uncertain',
  medium: 'uncertain',
  low: 'uncertain',
  vague: 'uncertain',
  missing: 'missing',
  absent: 'missing',
  none: 'missing',
  unknown: 'missing',
  not_found: 'missing',
};

/**
 * The calendar words a provider may use, and the word of our contract that
 * carries the same meaning.
 *
 * A word that is not listed here becomes "unknown", so a date of a calendar
 * we do not read is never applied to a form.
 */
const CALENDAR_WORDS: Readonly<Record<string, Calendar>> = {
  gregorian: 'gregorian',
  gregory: 'gregorian',
  'gregorian calendar': 'gregorian',
  milad: 'gregorian',
  ad: 'gregorian',
  unknown: 'unknown',
  unspecified: 'unknown',
};

/** The page numbers a provider may write as a text. */
const CANONICAL_PAGE = /^(?:[1-9]|10)$/;

/** The fields of the contract, used to keep a path of a refusal readable. */
const CONTRACT_FIELDS: ReadonlySet<string> = new Set([
  'pages',
  'page',
  'title',
  'document_number',
  'document_type_label',
  'ministry_label',
  'issue_date',
  'expiry_date',
  'value',
  'certainty',
  'source',
  'calendar',
]);

/** One translated word of the answer. */
export interface TranslatedWord {
  /** The place of the word in the answer, for example `pages.0.title.certainty`. */
  path: string;
  /** The word the provider wrote. */
  from: string;
  /** The word of our contract that carries the same meaning. */
  to: string;
}

/** The answer of a provider, translated into our vocabulary. */
export interface TranslatedAnswer {
  /** The translated answer, or null when the answer is not a batch of pages. */
  answer: unknown;
  /** The words the bridge translated, for the record of the answer. */
  words: TranslatedWord[];
}

/** Reports whether a value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the certainty of a field, in our words. */
export function certaintyOf(value: unknown): Certainty {
  if (typeof value !== 'string') return 'uncertain';
  return CERTAINTY_WORDS[value.trim().toLowerCase()] ?? 'uncertain';
}

/** Reads the calendar of a date, in our words. */
export function calendarOf(value: unknown): Calendar {
  if (typeof value !== 'string') return 'unknown';
  return CALENDAR_WORDS[value.trim().toLowerCase()] ?? 'unknown';
}

/**
 * Reads the page number of a page.
 *
 * Only a canonical page number is accepted as a text, so "1" is the first
 * page and "01", "1.0" or "one" are not a page number at all.
 */
function pageOf(value: unknown): unknown {
  if (typeof value === 'string' && CANONICAL_PAGE.test(value.trim())) return Number(value.trim());
  return value;
}

/**
 * Translates one field of a page.
 *
 * The field keeps every key it has, so the contract still refuses an answer
 * that carries a key it does not know. Only the two words of our contract
 * and the page number are translated.
 */
function translateField(field: unknown, path: string, withDate: boolean, words: TranslatedWord[]): unknown {
  if (!isRecord(field)) return field;
  const translated: Record<string, unknown> = { ...field };

  const certainty = field.certainty;
  if (typeof certainty === 'string') {
    const word = certaintyOf(certainty);
    if (word !== certainty) {
      words.push({ path: `${path}.certainty`, from: certainty, to: word });
      translated.certainty = word;
    }
  }

  if (withDate) {
    const calendar = field.calendar;
    if (typeof calendar === 'string') {
      const word = calendarOf(calendar);
      if (word !== calendar) {
        words.push({ path: `${path}.calendar`, from: calendar, to: word });
        translated.calendar = word;
      }
    }
    // A date that arrives without its own origin is a date we cannot vouch
    // for: the missing origin becomes the most careful value, never a date
    // that looks grounded.
    if (!('source' in translated)) translated.source = null;
    if (!('calendar' in translated)) translated.calendar = 'unknown';
  }

  return translated;
}

/**
 * Translates the answer of a provider into our vocabulary.
 *
 * Only the words are translated. An answer that is not a batch of pages
 * stays as it is, so the contract refuses it with the reason it deserves.
 */
export function translateAnswer(answer: unknown): TranslatedAnswer {
  if (!isRecord(answer) || !Array.isArray(answer.pages)) return { answer: null, words: [] };
  const words: TranslatedWord[] = [];
  const pages = answer.pages.map((page, index) => {
    const path = `pages.${index}`;
    if (!isRecord(page)) return page;
    const translated: Record<string, unknown> = { ...page };
    if ('page' in translated) translated.page = pageOf(translated.page);
    for (const key of ['title', 'document_number', 'document_type_label', 'ministry_label']) {
      if (key in translated) translated[key] = translateField(translated[key], `${path}.${key}`, false, words);
    }
    for (const key of ['issue_date', 'expiry_date']) {
      if (key in translated) translated[key] = translateField(translated[key], `${path}.${key}`, true, words);
    }
    return translated;
  });
  // The answer keeps every key it has, so an answer that carries a key the
  // contract does not know is still refused by the contract.
  return { answer: { ...answer, pages }, words };
}

/**
 * Reads the record of the translated words.
 *
 * The record carries the words of the vocabulary and their place in the
 * answer, and never a value of the document: the certainty and the calendar
 * of a field are words of the model, not the content of the page. A word
 * that is not a plain word is not recorded at all, because a provider may
 * write anything in the place of a word.
 */
export function describeWords(words: TranslatedWord[]): string {
  return words
    .slice(0, 12)
    .map((word) => `${word.path}:${readableWord(word.from)}->${word.to}`)
    .join(',');
}

/** Keeps a word of the vocabulary readable, and hides anything else. */
function readableWord(word: string): string {
  return /^[A-Za-z][A-Za-z _-]{0,23}$/.test(word) ? word : 'other';
}

/**
 * Keeps a token of the provider readable, and hides anything else.
 *
 * A provider may write anything in the place of a token, and a token may
 * carry a sentence of the document, so a token that is not a plain word is
 * never recorded.
 */
export function describeToken(token: unknown): string {
  return typeof token === 'string' ? readableWord(token) : 'other';
}

/**
 * Keeps the place of a refusal readable.
 *
 * A place names a field of the contract and nothing else: a provider may
 * write any key it likes, and a key may carry a sentence of the document.
 */
export function describePath(path: readonly PropertyKey[]): string {
  return path
    .map((part) => (typeof part === 'number' ? String(part) : CONTRACT_FIELDS.has(String(part)) ? String(part) : 'other'))
    .join('.');
}
