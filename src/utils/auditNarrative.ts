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
  anomaly_heavy_discount: 'amepunguza bei kwa kiasi kikubwa',
  anomaly_frequent_voids: 'amefuta bidhaa kikapuni mara nyingi',
  anomaly_stock_reduction: 'amepunguza stoo bila mauzo',
  anomaly_backdated: 'ameandika muamala wa tarehe ya nyuma',
  anomaly_delayed_delete: 'amefuta mauzo baada ya muda mrefu kupita',
  anomaly_off_hours: 'amefanya kazi nje ya masaa ya kawaida',
  anomaly_ghost_items: 'ameuza bidhaa zisizo na kumbukumbu sahihi',
  anomaly_expense_late: 'amerekodi matumizi kwa kuchelewa',
  anomaly_expense_vague_round: 'amerekodi matumizi yasiyo na maelezo ya kutosha',
  anomaly_expense_spike: 'amerekodi matumizi makubwa kuliko kawaida',
  anomaly_fake_debt: 'ameandika deni lenye mashaka',
  anomaly_debt_settle: 'amemaliza deni kwa njia isiyo ya kawaida',
};

const CHANGE_LABEL: Record<string, string> = {
  sell_price: 'bei ya kuuza',
  buy_price: 'bei ya kununua',
  stock: 'stoo',
  name: 'jina',
  notify_expiry_days: 'siku za tahadhari',
  min_stock: 'kizuizi',
};

/** Fields whose old/new values are money and should be formatted as such. */
const MONEY_FIELDS = new Set(['sell_price', 'buy_price']);

function who(log: AuditLike): string {
  return (
    log.user_name ||
    log.details?.employee_name ||
    log.details?.name_of_person_who_sold ||
    'Mfanyakazi'
  );
}

/** "tarehe 30 April saa 12:49 PM" */
function when(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  return `tarehe ${format(d, 'dd MMMM')} saa ${format(d, 'h:mm a')}`;
}

/** Joins names naturally: "Glass, Chocolate na Apple". */
function joinNames(names: string[]): string {
  const clean = names.filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  return `${clean.slice(0, -1).join(', ')} na ${clean[clean.length - 1]}`;
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
      const subject = items.length
        ? `${items.length > 1 ? 'bidhaa' : 'bidhaa'} ${joinNames(items)}`
        : 'mauzo';
      return {
        accent: 'sky',
        sentence:
          `${name} alitoa punguzo la bei kutoka ${money(d.original_price)} ` +
          `hadi ${money(d.price_on_discount)} kwa ${subject} ${at}.`,
      };
    }

    case 'refund_sale': {
      const items = productNames(d.items);
      const itemPhrase = items.length
        ? `${items.length > 1 ? 'Bidhaa zilizorudishwa ni' : 'Bidhaa iliyorudishwa ni'} ${joinNames(items)}`
        : 'Mauzo yamerudishwa';
      // Older rows predate `sale_date`; the clause is simply omitted for them.
      const soldOn = d.sale_date && !isNaN(new Date(d.sale_date).getTime())
        ? ` yaliyofanyika tarehe ${format(new Date(d.sale_date), 'dd/MM/yyyy')}`
        : '';
      const customer = d.customer ? ` kwa mteja ${d.customer}` : '';
      return {
        accent: 'sky',
        sentence:
          `${name} amerudisha mauzo${soldOn}. ` +
          `${itemPhrase} kwa thamani ya ${money(d.amount)}${customer}. ` +
          `Alifanya kitendo hiki ${at}.`,
      };
    }

    case 'edit_product': {
      const changes = d.changes ?? {};
      const clauses = Object.entries(changes)
        .map(([field, val]: [string, any]) => {
          const label = CHANGE_LABEL[field] ?? field;
          const fmt = (v: unknown) =>
            MONEY_FIELDS.has(field) ? money(v) : String(v ?? '—');
          return `${label} kutoka ${fmt(val?.old)} hadi ${fmt(val?.new)}`;
        })
        .filter(Boolean);

      if (!clauses.length) {
        return { accent: 'emerald', sentence: `${name} amehariri bidhaa ${d.name ?? ''} ${at}.` };
      }
      return {
        accent: 'emerald',
        sentence: `${name} amebadilisha ${joinNames(clauses)} kwa bidhaa ${d.name ?? ''} ${at}.`,
      };
    }

    case 'add_product': {
      const bits: string[] = [];
      if (d.stock !== undefined) bits.push(`stoo ${d.stock}`);
      if (d.sell_price !== undefined) bits.push(`bei ya kuuza ${money(d.sell_price)}`);
      const detail = bits.length ? ` — ${bits.join(', ')}` : '';
      return {
        accent: 'emerald',
        sentence: `${name} ameongeza bidhaa mpya ${d.name ?? ''}${detail} ${at}.`,
      };
    }

    case 'delete_product':
      return {
        accent: 'emerald',
        sentence: `${name} amefuta bidhaa ${d.name ?? ''} ${at}.`,
      };

    case 'delete_all_products':
      return {
        accent: 'emerald',
        sentence: `${name} amefuta bidhaa ${d.count ?? 0} kwa mkupuo ${at}.`,
      };

    case 'import_products': {
      const source = d.source === 'catalog' ? ' kutoka katalogi' : d.source ? ` kutoka ${d.source}` : '';
      return {
        accent: 'emerald',
        sentence: `${name} ameingiza bidhaa ${d.count ?? 0} kwa mkupuo${source} ${at}.`,
      };
    }

    case 'add_expense': {
      const desc = d.description ? ` kwa ajili ya "${d.description}"` : '';
      const category = d.category ? ` katika kundi la ${d.category}` : '';
      return {
        accent: 'violet',
        sentence: `${name} amerekodi matumizi ya ${money(d.amount)}${category}${desc} ${at}.`,
      };
    }

    default: {
      if (log.action.startsWith('anomaly_')) {
        const lead = ANOMALY_LEAD[log.action] ?? 'amefanya kitendo kinachohitaji ukaguzi';
        return {
          accent: 'teal',
          sentence: `${name} ${lead} ${at}.`,
          note: d.warning || d.details_text || undefined,
        };
      }
      return {
        accent: 'slate',
        sentence: `${name} amefanya kitendo cha ${log.action.replace(/_/g, ' ')} ${at}.`,
      };
    }
  }
}

/** Calm palette — no alarm red anywhere on this page. */
export const ACCENT_STYLES: Record<Accent, { bar: string; chip: string; icon: string }> = {
  emerald: { bar: 'bg-emerald-400', chip: 'bg-emerald-50 text-emerald-700', icon: 'text-emerald-600' },
  sky:     { bar: 'bg-sky-400',     chip: 'bg-sky-50 text-sky-700',         icon: 'text-sky-600' },
  violet:  { bar: 'bg-violet-400',  chip: 'bg-violet-50 text-violet-700',   icon: 'text-violet-600' },
  teal:    { bar: 'bg-teal-400',    chip: 'bg-teal-50 text-teal-700',       icon: 'text-teal-600' },
  slate:   { bar: 'bg-slate-300',   chip: 'bg-slate-50 text-slate-600',     icon: 'text-slate-500' },
};
