/**
 * The debt reminder a customer receives, by WhatsApp (Madeni, the chat's debts
 * card) or SMS (the chat's "Mkumbushe" task). One wording everywhere.
 *
 * Always Swahili: it goes to the customer, whatever language the app is in.
 * It names the business from its own record (shops.name), not the local
 * settings, which can be empty and used to fall back to "duka letu". It lists
 * what was bought, so the customer knows which debt it is.
 */

const MONTHS = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];

export interface ReminderItem { name: string; qty: number }

/** The business's own name: the shop record first, then the local settings. */
export function businessName(shop?: { name?: string | null } | null, settings?: { shopName?: string | null } | null): string {
  return (shop?.name ?? '').trim() || (settings?.shopName ?? '').trim();
}

/** The products on the given debts, added up by name. */
export function reminderItems(saleIds: string[], saleItems: { sale_id: string; product_name: string; qty: number; isDeleted?: number }[]): ReminderItem[] {
  const ids = new Set(saleIds);
  const byName = new Map<string, number>();
  for (const it of saleItems) {
    if (!ids.has(it.sale_id) || it.isDeleted === 1) continue;
    byName.set(it.product_name, (byName.get(it.product_name) ?? 0) + (Number(it.qty) || 0));
  }
  return [...byName.entries()].map(([name, qty]) => ({ name, qty }));
}

function day(d: string | Date): string {
  const x = new Date(d);
  return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}

export function debtReminderText(o: {
  customer: string;
  shopName?: string | null;
  /** Already formatted: "TSh 23,000". */
  amount: string;
  items: ReminderItem[];
  /** When the credit was taken: one date, or the dates of several debts. */
  dates?: (string | Date)[];
  /** WhatsApp: the full, friendly message. SMS: one short message (see smsReminder). */
  format?: 'whatsapp' | 'sms';
}): string {
  const name = (o.customer || 'Mteja').trim();
  const shop = (o.shopName ?? '').trim();
  const dates = (o.dates ?? []).filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d.getTime())).sort((a, c) => a.getTime() - c.getTime());
  if (o.format === 'sms') return smsReminder(name, shop, o.amount, o.items, dates[0] ?? null);

  const when = !dates.length ? '' : dates.length === 1 || day(dates[0]) === day(dates[dates.length - 1])
    ? ` ya tarehe ${day(dates[0])}`
    : ` ya kuanzia tarehe ${day(dates[0])}`;
  const lines: string[] = [`Habari ${name},`, ''];
  lines.push(`${shop ? `Hapa ni *${shop}*. ` : ''}Tunakukumbusha kwa upendo salio la deni lako la *${o.amount}* kwa manunuzi${when}${o.items.length ? ':' : '.'}`);
  if (o.items.length) {
    const shown = o.items.slice(0, o.items.length > 6 ? 5 : 6);
    for (const it of shown) lines.push(`- ${it.name} × ${qty(it.qty)}`);
    if (o.items.length > shown.length) lines.push(`- na bidhaa nyingine ${o.items.length - shown.length}`);
  }
  lines.push('', 'Unaweza kufanya malipo au kufika kwenye biashara yetu kumalizia deni hili. Asante sana kwa kusaidia biashara yetu, tunathamini sana ushirikiano wako! 🙏');
  return lines.join('\n');
}

const qty = (n: number) => String(Math.round(n * 100) / 100);

// ---------------------------------------------------------------- the SMS

/**
 * One SMS is 160 characters of the basic SMS alphabet (GSM-7). A single
 * character outside it (an emoji, "×", the non-breaking space in "TSh 23,000")
 * turns the whole message into Unicode, 70 characters a part: the old
 * reminder cost six SMS. So the SMS keeps to that alphabet and to 160.
 */
const GSM7 = new Set([..."@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const SMS_LIMIT = 160;

/** Into the basic SMS alphabet: look-alikes swapped, anything else dropped. */
function gsm(s: string): string {
  return s
    .replace(/[   ]/g, ' ')
    .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/…/g, '...')
    .split('').filter(c => GSM7.has(c)).join('')
    .replace(/\s+/g, ' ').trim();
}

/** "Mafuta ya Kupikia Korie 1L" → "Mafuta 1L": the first word and the pack size. */
function shortName(name: string): string {
  const words = gsm(name).split(' ').filter(Boolean);
  if (words.length <= 1) return words[0] ?? '';
  const size = words.slice(1).reverse().find(w => /^\d+(\.\d+)?(kg|g|gm|l|lt|ltr|ml|pcs|pc)$/i.test(w));
  return size ? `${words[0]} ${size}` : words[0];
}

function smsReminder(name: string, shop: string, amount: string, items: ReminderItem[], since: Date | null): string {
  const hello = `Habari ${gsm(name)}${shop ? `, hapa ni ${gsm(shop)}.` : '.'}`;
  const date = since ? ` tangu ${since.getDate()}/${since.getMonth() + 1}/${since.getFullYear()}` : '';
  const listed = items.length ? ` (${items.map(it => `${shortName(it.name)} x${qty(it.qty)}`).join(', ')})` : '';
  const counted = items.length ? ` (bidhaa ${items.length})` : '';
  const build = (what: string, ask: boolean) => `${hello} Deni lako ni ${gsm(amount)}${what}${date}.${ask ? ' Tafadhali lipa.' : ''} Asante.`;
  // Shortest that still says the most: the products, then their count, then
  // without "Tafadhali lipa". The name, amount and business are never cut.
  for (const text of [build(listed, true), build(counted, true), build(counted, false), build('', false)]) {
    if (text.length <= SMS_LIMIT) return text;
  }
  return build('', false);
}
