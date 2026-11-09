/**
 * The grounding of a date in the text the provider read.
 *
 * A document writes its dates in the order of its country: a civil id in
 * Kuwait writes `15/01/2024` and a document from elsewhere writes
 * `2024-01-15`. Both are the same calendar and the same digits, so both are
 * the day the provider read. The provider reports that day in the Gregorian
 * calendar as `2024-01-15` and repeats the text of the page as
 * `15/01/2024`, and the two describe the same day.
 *
 * The bridge therefore compares the digits of the source with the digits of
 * the date instead of comparing the two texts. A source is accepted when it
 * determines the date: the day-first reading of a source is accepted only
 * when the month-first reading is not a real calendar date, so `15/01/2024`
 * is the fifteenth of January while `05/06/2024` names two real days and is
 * left to the administrator. No calendar is converted and no component is
 * invented: every digit of an applied date comes from the source.
 */

import { calendarDate } from '../contracts/documentExtraction.js';

/** The digits of the Arabic-Indic numerals, in the order of their values. */
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/** The digits of the Eastern Arabic-Indic numerals, in the order of their values. */
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Writes the digits of a text as the ASCII digits.
 *
 * A document in Arabic writes its digits in Arabic-Indic numerals, and a
 * date the provider read keeps those digits. The digits are the same
 * digits, so they are written the way the contract writes them.
 */
export function asciiDigits(value: string): string {
  let result = '';
  for (const character of value) {
    const arabic = ARABIC_INDIC.indexOf(character);
    if (arabic >= 0) {
      result += String(arabic);
      continue;
    }
    const eastern = EASTERN_ARABIC_INDIC.indexOf(character);
    result += eastern >= 0 ? String(eastern) : character;
  }
  return result;
}

/** Writes a number of a date as the two digits of the contract. */
function pad(value: string | number): string {
  return String(value).padStart(2, '0');
}

/**
 * Reads the date that a source determines.
 *
 * The source is a number of a date: `15/01/2024` or `2024/01/15`, with
 * any of the three separators of a written date. The day-first reading is
 * accepted only when the month-first reading is not a real calendar date,
 * so a source that names two real days names no day and nothing is read
 * from it.
 */
export function dateFromSource(source: string): string | null {
  const dayFirst = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(source);
  if (dayFirst) {
    const year = dayFirst[3];
    const asDay = calendarDate(`${year}-${pad(dayFirst[2])}-${pad(dayFirst[1])}`);
    const asMonth = calendarDate(`${year}-${pad(dayFirst[1])}-${pad(dayFirst[2])}`);
    if (asDay && !asMonth) return asDay;
    if (asMonth && !asDay) return asMonth;
    return null;
  }
  const yearFirst = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(source);
  if (yearFirst) return calendarDate(`${yearFirst[1]}-${pad(yearFirst[2])}-${pad(yearFirst[3])}`);
  return null;
}

/**
 * Sorts the digits of a text, so two texts are compared by the digits they
 * carry and not by the order they write them in.
 */
function sortedDigits(value: string): string {
  return value.replace(/\D/g, '').split('').sort().join('');
}

/**
 * Reports whether a source names two real days.
 *
 * `01/11/2024` is the first of November and the eleventh of January, and
 * the source alone does not say which one the page writes. A day that the
 * source does not determine is not applied, whatever the provider made of
 * it, so the administrator confirms it instead.
 */
export function sourceIsAmbiguous(source: string): boolean {
  const parts = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(source);
  if (!parts) return false;
  const [, first, second, year] = parts;
  const asDay = calendarDate(`${year}-${pad(second)}-${pad(first)}`);
  const asMonth = calendarDate(`${year}-${pad(first)}-${pad(second)}`);
  return asDay !== null && asMonth !== null && asDay !== asMonth;
}

/**
 * Reads the date of a field when the source grounds it.
 *
 * The provider reports a day twice: as the value and as the text of the
 * page it read. Both are read as the day they carry, and both must carry
 * the same day. The day is applied when it is a real calendar date and
 * either the value or the source determines it; the digits of the source
 * must be the digits of that day, so a source that names other digits
 * contradicts the provider and is refused. A source that names the field
 * instead of the date carries no digits and contradicts nothing.
 *
 * Nothing is converted and no component is invented: every digit of an
 * applied date comes from the value or from the source, and a day that
 * neither of them determines is never applied.
 */
export function groundedDate(value: string, raw: { calendar: string; source: string | null }): string | null {
  if (raw.calendar !== 'gregorian') return null;
  const source = asciiDigits(raw.source?.trim() ?? '');
  // The source that names two real days does not determine a day, so the
  // date stays for the administrator, whatever the provider read from it.
  if (sourceIsAmbiguous(source)) return null;
  const fromValue = calendarDate(asciiDigits(value)) ?? dateFromSource(asciiDigits(value));
  const fromSource = source ? (calendarDate(source) ?? dateFromSource(source)) : null;
  if (fromValue && fromSource && fromValue !== fromSource) return null;
  const date = fromValue ?? fromSource;
  if (!date) return null;
  if (sortedDigits(source) && sortedDigits(source) !== sortedDigits(date)) return null;
  return date;
}
