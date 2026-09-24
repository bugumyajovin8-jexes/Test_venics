/**
 * The sentences a user must type to confirm an irreversible deletion.
 *
 * One module so the phrase and the button label cannot drift apart. The history
 * gate asks for "…historia za Wiki Hii", and "Wiki Hii" has to be exactly what
 * the button said — if a label is ever reworded and the phrase is not, the gate
 * becomes unpassable and the only clue is a user who cannot delete anything.
 *
 * Kept identical in the mobile, desktop and invoice apps: the same shopkeeper
 * uses more than one of them, and a phrase that changes between devices would
 * read as a bug.
 */

export const DELETE_ALL_PRODUCTS_PHRASE = 'Nataka kufuta bidhaa zote';

export type HistoryPeriod = 'today' | 'week' | 'month' | 'year' | 'all';

/** Button labels, and the words that go into the typed sentence. */
export const HISTORY_PERIOD_LABELS: Record<HistoryPeriod, string> = {
  today: 'Leo',
  week: 'Wiki Hii',
  month: 'Mwezi Huu',
  year: 'Mwaka Huu',
  all: 'Zote',
};

export function deleteHistoryPhrase(period: HistoryPeriod): string {
  return `Nataka kufuta historia za ${HISTORY_PERIOD_LABELS[period]}`;
}
