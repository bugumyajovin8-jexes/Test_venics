/**
 * Tanzanian mobile numbers.
 *
 * One stored form everywhere: `255` + 9 digits, no plus sign — how Supabase
 * Auth stores a login number, how invitations are matched, and what Beem
 * expects. Supabase's API takes the same number with a plus (`toE164`).
 *
 * normalizeTzPhone is kept identical to supabase/functions/_shared/phone.ts.
 */
export function normalizeTzPhone(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let digits = String(input).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  if (digits.startsWith('255')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  // Mobile ranges start with 6 or 7 (Vodacom, Airtel, Tigo/Yas, Halotel, TTCL…).
  if (!/^[67]\d{8}$/.test(digits)) return null;
  return `255${digits}`;
}

/** `+255712345678`, for supabase.auth calls. */
export function toE164(normalized: string): string {
  return `+${normalized}`;
}

/** `0712 345 678` — how people write their own number. */
export function formatTzPhone(input: unknown): string {
  const n = normalizeTzPhone(input);
  if (!n) return typeof input === 'string' ? input : '';
  const local = `0${n.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** First number-looking run in free text ("Mwalike 0712 345 678"). */
export function extractTzPhone(text: string): string | null {
  const matches = String(text ?? '').match(/(?:\+?255|0)?[\s-]?[67]\d{2}[\s-]?\d{3}[\s-]?\d{3}/g) ?? [];
  for (const m of matches) {
    const n = normalizeTzPhone(m);
    if (n) return n;
  }
  return null;
}

/** `0712 *** 678` — enough to recognise, not enough to copy. */
export function maskTzPhone(input: unknown): string {
  const f = formatTzPhone(input);
  return f.length === 12 ? `${f.slice(0, 4)} *** ${f.slice(9)}` : '***';
}
