/**
 * The app's languages: Kiswahili, and English.
 *
 * Swahili is the source. Text is written in Swahili in the code, wrapped in
 * t(), and English is looked up by that Swahili text in ./en. Text with no
 * English yet falls back to the Swahili, so nothing ever shows blank.
 *
 *   t('Hifadhi')                                  -> "Save" in English
 *   t('Umehamia kwenye duka la "{name}"', { name }) -> values go in by name, so
 *                                                    English can put them in
 *                                                    its own word order
 *
 * The choice belongs to the DEVICE (localStorage), not the account: it is read
 * once at start-up, works offline, and two people sharing a till can differ.
 * Changing it reloads the app, so everything is drawn again in the new
 * language — including text a module built when it loaded.
 *
 * What customers receive stays in Swahili whatever this says: receipts and
 * invoices, WhatsApp messages to customers and suppliers, and the invite SMS.
 */

import EN from './en';

export type Lang = 'sw' | 'en';

const STORAGE_KEY = 'venics_lang';

function readStored(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'sw';
  } catch {
    return 'sw';
  }
}

let current: Lang = readStored();

try {
  document.documentElement.lang = current;
} catch {
  /* not in a browser (tests) */
}

export function getLang(): Lang {
  return current;
}

/** Switches language and redraws the whole app in it. */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage blocked: lasts until the app is closed */
  }
  current = lang;
  window.location.reload();
}

type Vars = Record<string, string | number | null | undefined>;

/**
 * The text in the device's language. `sw` is the Swahili, as written in the code.
 *
 * Values go in by name: {name}. A word that changes with a number is written
 * {count|singular|plural} — "{days} {days|day|days} ago" — so English need not
 * say "1 days". Swahili rarely needs it, but may use it the same way.
 */
export function t(sw: string, vars?: Vars): string {
  const text = current === 'en' ? (EN[sw] ?? sw) : sw;
  if (!vars) return text;
  return text.replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (whole, name: string, one?: string, other?: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole;
    const value = vars[name];
    if (one === undefined) return String(value ?? '');
    return Number(value) === 1 ? one : other ?? '';
  });
}

const MONTHS: Record<Lang, string[]> = {
  sw: ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const WEEKDAYS: Record<Lang, string[]> = {
  sw: ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

/** Month names, January first — index with Date#getMonth(). */
export function monthNames(): string[] {
  return MONTHS[current];
}

/** Weekday names, Sunday first — index with Date#getDay(). */
export function weekdayNames(): string[] {
  return WEEKDAYS[current];
}

/** The locale for toLocaleDateString / toLocaleTimeString in this language. */
export function dateLocale(): string {
  return current === 'en' ? 'en-GB' : 'sw-TZ';
}

/**
 * For text that is data rather than code — a value stored in the database or
 * sent by the server, such as an expense category or an error message. Shown
 * in English when the dictionary knows it, otherwise as it came.
 */
export function tData(value: string | null | undefined): string {
  if (!value) return value ?? '';
  return current === 'en' ? (EN[value] ?? value) : value;
}
