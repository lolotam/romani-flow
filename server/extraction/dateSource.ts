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
 * Reads the date of a field when the source grounds it.
 *
 * The date is the date of the provider when the source names the same day:
 * either the source repeats the date, or the source determines it. A source
 * of another calendar, a value that is not a real calendar date and a source
 * that names the day in another order than the provider read it are all
 * refused, so a date is never applied that the source does not carry.
 */
export function groundedDate(value: string, raw: { calendar: string; source: string | null }): string | null {
  if (raw.calendar !== 'gregorian') return null;
  const digits = asciiDigits(value);
  const date = calendarDate(digits) ?? dateFromSource(digits);
  if (!date) return null;
  const source = asciiDigits(raw.source?.trim() ?? '');
  if (source === date) return date;
  return dateFromSource(source) === date ? date : null;
}
