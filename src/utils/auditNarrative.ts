/**
 * Audit narratives.
 *
 * The old card showed a bare label ("Alitoa punguzo la bei") and scattered the
 * who / how much / which product / when across separate boxes, so a boss had to
 * hunt around one card to reconstruct a single event.
 *
 * Here each entry becomes ONE readable sentence containing everything that
 * matters, built from the payload each action actually writes.
 *
 * Tone is deliberately calm. These entries are for review, not accusation —
 * the boss already knows why they are looking at this page, so alarm-red adds
 * pressure without adding information.
 */

import { format } from 'date-fns';
import { formatCurrency } from './format';

import { t, tData, monthNames } from '../i18n';
export type Accent = 'emerald' | 'sky' | 'violet' | 'teal' | 'slate';

export interface AuditNarrative {
  /** The full sentence — who did what, to which item, for how much, when. */
  sentence: string;
  /** Extra context (an anomaly's explanation), shown quietly beneath. */
  note?: string;
  accent: Accent;
}

interface AuditLike {
  action: string;
  user_name?: string;
  user_id?: string;
  details?: any;
  created_at: string;
}

const ANOMALY_LEAD: Record<string, string> = {
  anomaly_heavy_discount: t('amepunguza bei kwa kiasi kikubwa'),
  anomaly_frequent_voids: t('amefuta bidhaa kikapuni mara nyingi'),
  anomaly_stock_reduction: t('amepunguza stoo bila mauzo'),
  anomaly_backdated: t('ameandika muamala wa tarehe ya nyuma'),
  anomaly_delayed_delete: t('amefuta mauzo baada ya muda mrefu kupita'),
  anomaly_off_hours: t('amefanya kazi nje ya masaa ya kawaida'),
  // anomaly_ghost_items is deliberately absent: it has no human actor and
  // nothing was sold, so it cannot be phrased as "<person> <did something>".
  // It gets its own case in describeAudit().
  anomaly_expense_late: t('amerekodi matumizi kwa kuchelewa'),
  anomaly_expense_vague_round: t('amerekodi matumizi yasiyo na maelezo ya kutosha'),
  anomaly_expense_spike: t('amerekodi matumizi makubwa kuliko kawaida'),
  anomaly_fake_debt: t('ameandika deni lenye mashaka'),
  anomaly_debt_settle: t('amemaliza deni kwa njia isiyo ya kawaida'),
};

const CHANGE_LABEL: Record<string, string> = {
  sell_price: t('bei ya kuuza'),
  buy_price: t('bei ya kununua'),
  stock: t('stoo'),
  name: t('jina'),
  notify_expiry_days: t('siku za tahadhari'),
  min_stock: t('kizuizi'),
  expiry_date: t('tarehe ya kuisha'),
  track_stock: t('ufuatiliaji wa stoo'),
};

/**
 * Keys inside `changes` that are NOT an {old, new} pair and must never reach the
 * generic "X kutoka A hadi B" renderer.
 *
 * `stock_added` and `audit_discrepancy` are bare numbers, so the generic path
 * read `.old` and `.new` off a number, got undefined for both, and printed
 * "stock_added kutoka — hadi —" on the boss's audit page. `stock_added` is
 * dropped outright (for an increase, new − old already says how many arrived);
 * `audit_discrepancy` is consumed by the stock clause, where it changes the verb.
 */
const CONSUMED_KEYS = new Set(['stock', 'stock_added', 'audit_discrepancy', 'expiry_date']);

/** A change entry is only renderable as "kutoka A hadi B" if it is a pair. */
function isPair(v: any): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && ('old' in v || 'new' in v);
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 1200 -> "1,200"; keeps decimals only when the value actually has them. */
function count(v: unknown): string {
  const n = num(v);
  return n === null ? String(v ?? '—') : n.toLocaleString();
}

/** '2027-03-12' or an ISO timestamp -> '12/03/2027'. Falls back to the raw text. */
function niceDate(v: unknown): string {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : format(d, 'dd/MM/yyyy');
}

/** Fields whose old/new values are money and should be formatted as such. */
const MONEY_FIELDS = new Set(['sell_price', 'buy_price']);

function who(log: AuditLike): string {
  return (
    log.user_name ||
    log.details?.employee_name ||
    log.details?.name_of_person_who_sold ||
    t('Mfanyakazi')
  );
}

/** "tarehe 30 Aprili saa 12:49 PM" — the month in the page's own language. */
function when(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  return t('tarehe {d} saa {d2}', { d: `${format(d, 'dd')} ${monthNames()[d.getMonth()]}`, d2: format(d, 'h:mm a') });
}

/** Joins names naturally: "Glass, Chocolate na Apple". */
function joinNames(names: string[]): string {
  const clean = names.filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  return t('{list} na {last}', { list: clean.slice(0, -1).join(', '), last: clean[clean.length - 1] });
}

function productNames(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => (typeof r === 'string' ? r : r?.name)).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function describeAudit(log: AuditLike, currency: string): AuditNarrative {
  const d = log.details ?? {};
  const name = who(log);
  const at = when(log.created_at);
  const money = (v: unknown) => formatCurrency(Number(v) || 0, currency);

  switch (log.action) {
    case 'discounted_sale': {
      const items = productNames(d.name_of_product);
      // Through t() so an English screen does not read "on bidhaa Sukari 1kg".
      const subject = items.length
        ? t('bidhaa {list}', { list: joinNames(items) })
        : t('mauzo');
      return {
        accent: 'sky',
        sentence:
          t('{name} alitoa punguzo la bei kutoka {original_price} ', { name, original_price: money(d.original_price) }) +
          t('hadi {price_on_discount} kwa {subject} {at}.', { price_on_discount: money(d.price_on_discount), subject, at }),
      };
    }

    case 'refund_sale': {
      const items = productNames(d.items);
      const itemPhrase = items.length
        ? `${items.length > 1 ? t('Bidhaa zilizorudishwa ni') : t('Bidhaa iliyorudishwa ni')} ${joinNames(items)}`
        : t('Mauzo yamerudishwa');
      // Older rows predate `sale_date`; the clause is simply omitted for them.
      const soldOn = d.sale_date && !isNaN(new Date(d.sale_date).getTime())
        ? t(' yaliyofanyika tarehe {format}', { format: format(new Date(d.sale_date), 'dd/MM/yyyy') })
        : '';
      const customer = d.customer ? t(' kwa mteja {customer}', { customer: d.customer }) : '';
      return {
        accent: 'sky',
        sentence:
          t('{name} amerudisha mauzo{soldOn}. ', { name, soldOn }) +
          t('{itemPhrase} kwa thamani ya {amount}{customer}. ', { itemPhrase, amount: money(d.amount), customer }) +
          t('Alifanya kitendo hiki {at}.', { at }),
      };
    }

    case 'edit_product': {
      const changes = d.changes ?? {};
      const product = d.name ?? '';

      // Each part is a complete verb phrase, so they can be strung together with
      // ", na " without one verb having to govern clauses it does not fit.
      const parts: string[] = [];
      // Set when a clause has already named the product inside itself.
      let namedProduct = false;

      // --- STOCK -----------------------------------------------------------
      // "amebadilisha stoo kutoka 30 hadi 12" told a boss that a number moved
      // but not what happened. Direction is the whole point of this page: stock
      // going UP is a delivery, stock going DOWN without a sale is the thing
      // worth looking at, and stock moving after a shelf count is neither.
      const stock = changes.stock;
      const oldStock = isPair(stock) ? num(stock.old) : null;
      const newStock = isPair(stock) ? num(stock.new) : null;
      const discrepancy = num(changes.audit_discrepancy);

      if (oldStock !== null && newStock !== null && oldStock !== newStock) {
        const range = t('kutoka {oldStock} kwenda {newStock}', { oldStock: count(oldStock), newStock: count(newStock) });
        const of = product ? t(' ya {product}', { product }) : '';
        if (product) namedProduct = true;

        if (discrepancy !== null) {
          // Came from the photo stock-count, not from someone editing a number.
          // Phrasing it as an unexplained reduction would accuse an employee who
          // did exactly the right thing.
          const gap = Math.abs(discrepancy);
          const kind = discrepancy < 0 ? t('pungufu') : t('ziada');
          parts.push(t('amerekebisha idadi{of} {range} baada ya kuhesabu stoo ({kind} {gap})', { of, range, kind, gap: count(gap) }));
        } else if (newStock > oldStock) {
          parts.push(t('ameongeza idadi{of} {range}', { of, range }));
        } else {
          parts.push(t('amepunguza idadi{of} {range} kwa ku-edit', { of, range }));
        }
      }

      // --- EXPIRY ----------------------------------------------------------
      // Written two ways: a bare date string when set while adding stock, and an
      // {old, new} pair when edited from the calendar. The pair falls through to
      // the generic renderer below; only the bare form needs its own verb.
      const expiry = changes.expiry_date;
      if (expiry !== undefined && !isPair(expiry)) {
        parts.push(t('amewekea tarehe ya kuisha {expiry}', { expiry: niceDate(expiry) }));
      }

      // --- EVERYTHING ELSE -------------------------------------------------
      const other = Object.entries(changes)
        .filter(([field, val]) => !CONSUMED_KEYS.has(field) && isPair(val))
        .map(([field, val]: [string, any]) => {
          const label = CHANGE_LABEL[field] ?? field;
          const fmt = (v: unknown) =>
            MONEY_FIELDS.has(field) ? money(v) : String(v ?? '—');
          return t('{label} kutoka {old} hadi {new}', { label, old: fmt(val?.old), new: fmt(val?.new) });
        });
      if (isPair(expiry)) {
        other.push(t('tarehe ya kuisha kutoka {old} hadi {new}', { old: niceDate(expiry.old), new: niceDate(expiry.new) }));
      }
      if (other.length) parts.push(t('amebadilisha {changes}', { changes: joinNames(other) }));

      if (!parts.length) {
        return {
          accent: 'emerald',
          sentence: t('{name} amehariri bidhaa {product}, amefanya tukio hili {at}.', { name, product, at }),
        };
      }

      // The product is named inside the stock clause; repeating it afterwards
      // reads as though two different products were touched. Tracked with a flag
      // rather than sniffing the text — "amewekea tarehe ya kuisha" also contains
      // " ya ", and a string test would have dropped the product name from every
      // expiry-only entry.
      const tail = namedProduct || !product ? '' : t(' kwa bidhaa {product}', { product });
      // "amefanya tukio hili" before the timestamp. An edit can now carry a
      // second date of its own — an expiry — and "...tarehe ya kuisha 12/03/2027,
      // tarehe 30 Agosti..." left the boss with two dates and no way to tell
      // which one is when it happened. The phrase names the one that is the
      // event. (refund_sale already does this with "Alifanya kitendo hiki".)
      return {
        accent: 'emerald',
        sentence: t('{name} {parts}{tail}, amefanya tukio hili {at}.', { name, parts: parts.join(t(', na ')), tail, at }),
      };
    }

    case 'add_product': {
      const bits: string[] = [];
      if (d.stock !== undefined) bits.push(t('stoo {stock}', { stock: d.stock }));
      if (d.sell_price !== undefined) bits.push(t('bei ya kuuza {sell_price}', { sell_price: money(d.sell_price) }));
      const detail = bits.length ? ` — ${bits.join(', ')}` : '';
      return {
        accent: 'emerald',
        sentence: t('{name} ameongeza bidhaa mpya {v}{detail} {at}.', { name, v: d.name ?? '', detail, at }),
      };
    }

    case 'delete_product':
      return {
        accent: 'emerald',
        sentence: t('{name} amefuta bidhaa {v} {at}.', { name, v: d.name ?? '', at }),
      };

    case 'delete_all_products': {
      // The same action covers "delete everything" from Bidhaa and the narrower
      // sweep from /ExcessProducts. Saying which one it was matters: one wipes
      // the catalogue, the other only clears what was already empty. Older
      // sweeps took every empty product; newer ones only those never sold.
      const scope = d.scope === 'zero_stock_never_sold'
        ? t(' zisizokuwa na stoo wala mauzo yoyote')
        : d.scope === 'zero_stock' ? t(' zilizokuwa zimeisha') : '';
      return {
        accent: 'emerald',
        sentence: t('{name} amefuta bidhaa {v}{scope} kwa mkupuo {at}.', { name, v: d.count ?? 0, scope, at }),
      };
    }

    case 'import_products': {
      const source = d.source === 'catalog' ? t(' kutoka katalogi') : d.source ? t(' kutoka {source}', { source: d.source }) : '';
      return {
        accent: 'emerald',
        sentence: t('{name} ameingiza bidhaa {v} kwa mkupuo{source} {at}.', { name, v: d.count ?? 0, source, at }),
      };
    }

    case 'add_expense': {
      const desc = d.description ? t(' kwa ajili ya "{description}"', { description: d.description }) : '';
      const category = d.category ? t(' katika kundi la {category}', { category: tData(d.category) }) : '';
      return {
        accent: 'violet',
        sentence: t('{name} amerekodi matumizi ya {amount}{category}{desc} {at}.', { name, amount: money(d.amount), category, desc, at }),
      };
    }

    /**
     * Stock that is not moving.
     *
     * The check finds products that HAVE stock but have recorded no sale for
     * three days. Nobody sold anything and no employee is involved — the row is
     * written by the app itself with user_name "Mfumo".
     *
     * Routing it through the generic anomaly template produced "Mfumo ameuza
     * bidhaa zisizo na kumbukumbu sahihi" — "The System sold products without
     * proper records" — which inverted the finding (they did NOT sell) and read
     * as though the app were the suspect. So the sentence is built here from the
     * product list instead, with no subject at all.
     *
     * Built from `ghost_items` rather than the stored `warning` text, so entries
     * already saved by earlier versions are re-narrated correctly too.
     */
    case 'anomaly_ghost_items': {
      const items = productNames(d.ghost_items);
      const count = items.length;
      const named = count ? `: ${joinNames(items)}` : '';
      return {
        accent: 'slate',
        sentence: count === 1
          ? t('Bidhaa 1 huuzwa karibia kila siku lakini haijauzwa kwa siku 3{named}. Huenda mfanyakazi hairekodi kwenye mfumo {at}.', { named, at })
          : t('Bidhaa {count} huuzwa karibia kila siku lakini hazijauzwa kwa siku 3{named}. Huenda mfanyakazi hazirekodi kwenye mfumo {at}.', { count, named, at }),
        note: t('Hii si kosa la mfanyakazi — ni ukumbusho tu wa kuangalia kama bidhaa hizi bado zinahitajika, au kama mauzo yake hayaandikwi kwenye mfumo.'),
      };
    }

    /**
     * Found by the sync, not done by anyone (services/sync.ts): the shop sold
     * more than it had, because two devices sold the same stock before they
     * could see each other. Names the product and the shortfall, blames no one.
     */
    case 'anomaly_stock_oversold': {
      return {
        accent: 'slate',
        sentence: t('Bidhaa "{product}" iliuzwa zaidi ya stoo iliyokuwepo (pungufu {short}) {at}: vifaa viwili viliiuza kabla ya kusawazishana.', { product: d.product_name || '—', short: count(d.shortfall), at }),
        note: t('Stoo yake imewekwa 0. Ihesabu upya kwenye Bidhaa ili iwe sahihi.'),
      };
    }

    // A count typed on a device that was behind: the server took the
    // difference instead of the figure (services/sync.ts).
    case 'anomaly_stale_recount': {
      return {
        accent: 'teal',
        sentence: t('{name} alihesabu "{product}" kama {counted}, lakini kifaa chake kilikuwa nyuma: mfumo ulikuwa na {server_stock} {at}.', { name, product: d.product_name || '—', counted: count(d.counted), server_stock: count(d.server_stock), at }),
        note: t('Tofauti tu ndiyo imetumika badala ya hesabu yake — hakiki stoo ya bidhaa hii.'),
      };
    }

    default: {
      if (log.action.startsWith('anomaly_')) {
        const lead = ANOMALY_LEAD[log.action] ?? t('amefanya kitendo kinachohitaji ukaguzi');
        return {
          accent: 'teal',
          sentence: `${name} ${lead} ${at}.`,
          note: d.warning || d.details_text || undefined,
        };
      }
      return {
        accent: 'slate',
        sentence: t('{name} amefanya kitendo cha {replace} {at}.', { name, replace: log.action.replace(/_/g, ' '), at }),
      };
    }
  }
}

/**
 * Entries about the shop's stock that no person wrote: the sync and the stock
 * checks write them (services/sync.ts), signed "Mfumo".
 */
export const SYSTEM_NOTICES = new Set(['anomaly_stock_oversold', 'anomaly_ghost_items']);

/**
 * An anomaly about something a member of staff did — what the security
 * notices and Venics Smart's risk figures count. An oversell is not one: two
 * devices sold the same stock before they could see each other.
 */
export function isStaffAnomaly(action?: string | null): boolean {
  return !!action && action.startsWith('anomaly_') && action !== 'anomaly_stock_oversold';
}

/** The name under an entry: "Mfumo" for a notice nobody wrote. */
export function auditActor(log: { action: string; user_name?: string; details?: any }): string {
  if (SYSTEM_NOTICES.has(log.action) || log.user_name === 'Mfumo') return t('Mfumo');
  return log.user_name || log.details?.employee_name || t('Mfanyakazi');
}

/**
 * Kept in the record, but not shown on Shughuli za Wafanyakazi:
 *  - an oversell notice for a product deleted since, or a repeat of one already
 *    listed (older versions wrote one per download of the same figure);
 *  - what the boss did themselves: the page is what staff did.
 * `seen` carries the oversells already listed, so call it oldest first.
 */
export function isActivityNoise(
  log: { action: string; user_id?: string; user_name?: string; details?: any },
  liveProductIds: Set<string>,
  bossIds: Set<string>,
  seen: Set<string>,
): boolean {
  if (log.action === 'anomaly_stock_oversold') {
    const pid = log.details?.product_id;
    if (!pid || !liveProductIds.has(pid)) return true;
    const key = `${pid}:${log.details?.shortfall ?? ''}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  }
  return !!log.user_id && bossIds.has(log.user_id) && log.user_name !== 'Mfumo' && !SYSTEM_NOTICES.has(log.action);
}

/** Calm palette — no alarm red anywhere on this page. */
export const ACCENT_STYLES: Record<Accent, { bar: string; chip: string; icon: string }> = {
  emerald: { bar: 'bg-emerald-400', chip: 'bg-emerald-50 text-emerald-700', icon: 'text-emerald-600' },
  sky:     { bar: 'bg-sky-400',     chip: 'bg-sky-50 text-sky-700',         icon: 'text-sky-600' },
  violet:  { bar: 'bg-violet-400',  chip: 'bg-violet-50 text-violet-700',   icon: 'text-violet-600' },
  teal:    { bar: 'bg-teal-400',    chip: 'bg-teal-50 text-teal-700',       icon: 'text-teal-600' },
  slate:   { bar: 'bg-slate-300',   chip: 'bg-slate-50 text-slate-600',     icon: 'text-slate-500' },
};
