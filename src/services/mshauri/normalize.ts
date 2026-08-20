/**
 * Query normalizer.
 *
 * Turns raw Swahili/English shop-owner text into a concept set plus a detected
 * question form. Unlike the old QueryParser it never collapses a word into a
 * single lossy bucket, and its typo tolerance is deliberately narrow (see
 * `fuzzyLookup`) so short words can't false-match across the vocabulary.
 */

import { Concept, VOCAB_INDEX, MULTIWORD_FORMS } from './concepts';

export type QuestionForm =
  | 'HOWTO'   // "jinsi ya…", "nawezaje…"
  | 'WHERE'   // "…iko wapi"
  | 'WHY'     // "mbona…", "kwa nini…"
  | 'DATA'    // "…kiasi gani", "…ngapi", "nani…"
  | 'ADVICE'  // "nifanye nini ili…", "nishauri…"
  | 'PLAIN';

export interface NormalizedQuery {
  raw: string;
  cleaned: string;
  tokens: string[];
  concepts: Set<Concept>;
  /** concept → accumulated weight, used for scoring strength. */
  weights: Map<Concept, number>;
  form: QuestionForm;
  has: (c: Concept) => boolean;
  hasAll: (cs: Concept[]) => boolean;
  hasAny: (cs: Concept[]) => boolean;
}

const STOP_WORDS = new Set([
  'ya', 'za', 'la', 'wa', 'kwa', 'na', 'ni', 'ili', 'hili', 'hadi', 'hivi', 'huu',
  'cha', 'vya', 'pa', 'mwenye', 'wenye', 'yake', 'zake', 'lake', 'wake', 'yao',
  'wao', 'vyake', 'chake', 'yote', 'zote', 'lote', 'wote', 'hapa', 'juu', 'chini',
  'kila', 'kama', 'kutoka', 'kwenda', 'ambao', 'ambayo', 'ambazo', 'the', 'a', 'an',
  'to', 'of', 'for', 'in', 'on', 'with', 'by', 'at', 'about', 'is', 'do', 'i', 'my',
]);

/** Question-form cues, checked against the raw (pre-stopword) text. */
const FORM_PATTERNS: Array<{ form: QuestionForm; re: RegExp }> = [
  // `\w{3,}je` catches the Swahili interrogative suffix generally —
  // nifutaje, nitafanyaje, nawezaje, niongezaje — instead of listing each verb.
  { form: 'HOWTO', re: /\b(jinsi|namna|vipi|hatua|how\s+(do|can|to)|\w{3,}je)\b/i },
  { form: 'WHERE', re: /\b(wapi|where)\b/i },
  { form: 'WHY', re: /\b(mbona|kwa\s?nini|kwanini|why|sababu)\b/i },
  { form: 'ADVICE', re: /\b(nishauri|ushauri|nipendekezee|mapendekezo|nifanye\s+nini|nifanyeje\s+ili|advice|should\s+i|nitafanyaje\s+ili)\b/i },
  { form: 'DATA', re: /\b(kiasi\s+gani|ngapi|nani|how\s+much|how\s+many|who|kiwango|jumla|onyesha|nionyeshe|orodhesha)\b/i },
];

/** Levenshtein distance, capped early for speed. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Narrow typo tolerance. The old engine fuzzy-matched every token against ~200
 * dictionary keys at a 0.75 threshold, which generated false positives on short
 * words. Here a token must be at least 5 characters and within edit distance 1
 * (or 2 for long words) of a single-word vocabulary entry of similar length.
 */
function fuzzyLookup(token: string): string | null {
  if (token.length < 5) return null;

  const maxDistance = token.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const key of VOCAB_INDEX.keys()) {
    if (key.includes(' ')) continue;
    if (Math.abs(key.length - token.length) > maxDistance) continue;

    const d = levenshtein(token, key);
    if (d < bestDistance) {
      bestDistance = d;
      best = key;
      if (d === 0) break;
    }
  }

  return bestDistance <= maxDistance ? best : null;
}

/**
 * Light Bantu prefix stripping, applied only as a last resort and only when the
 * stripped stem is a known vocabulary word (never inventing a stem).
 */
function stripPrefix(token: string): string | null {
  const prefixes = ['wa', 'mi', 'ma', 'ki', 'vi', 'ku', 'm', 'u'];
  for (const p of prefixes) {
    if (token.length > p.length + 2 && token.startsWith(p)) {
      const stem = token.slice(p.length);
      if (VOCAB_INDEX.has(stem)) return stem;
    }
  }
  return null;
}

/**
 * Swahili verbs carry subject and tense as prefixes and can take the `-je`
 * ("how") suffix, so `nifutaje` and `nimeuza` never appear in a word list.
 * This peels those affixes off, but only ever returns a stem that is already a
 * known vocabulary word — it never invents one.
 */
const SUBJECT_PREFIXES = ['ni', 'u', 'a', 'tu', 'm', 'wa', 'ha', 'si', 'ki', 'zi', 'li', 'ya', 'i'];
const TENSE_MARKERS = ['na', 'me', 'li', 'ta', 'ki', 'ka', 'hu', 'nge'];

function verbLookup(token: string): string | null {
  const bases = [token];
  if (token.endsWith('je') && token.length > 4) bases.push(token.slice(0, -2));

  // Swahili subjunctive/imperative ends in -e where the dictionary form ends
  // in -a: ondoa → niondoe, ongeza → niongeze.
  const asIndicative = (w: string) => (w.endsWith('e') ? w.slice(0, -1) + 'a' : null);

  const resolve = (w: string): string | null => {
    if (VOCAB_INDEX.has(w)) return w;
    const alt = asIndicative(w);
    return alt && VOCAB_INDEX.has(alt) ? alt : null;
  };

  for (const base of bases) {
    const direct = resolve(base);
    if (direct) return direct;

    for (const subject of SUBJECT_PREFIXES) {
      if (!base.startsWith(subject) || base.length <= subject.length + 2) continue;
      const afterSubject = base.slice(subject.length);
      const hit = resolve(afterSubject);
      if (hit) return hit;

      for (const tense of TENSE_MARKERS) {
        if (!afterSubject.startsWith(tense) || afterSubject.length <= tense.length + 2) continue;
        const root = resolve(afterSubject.slice(tense.length));
        if (root) return root;
      }
    }
  }

  return null;
}

function detectForm(text: string): QuestionForm {
  for (const { form, re } of FORM_PATTERNS) {
    if (re.test(text)) return form;
  }
  return 'PLAIN';
}

/**
 * Which language the question was asked in.
 *
 * Counts function words rather than content words: a shop owner writing in
 * English still types Swahili product names ("how much Sukari did I sell"),
 * so only the grammar words are reliable evidence.
 */
const EN_MARKERS = new Set([
  'how', 'what', 'why', 'when', 'which', 'who', 'where', 'the', 'is', 'are',
  'do', 'does', 'did', 'can', 'should', 'my', 'me', 'i', 'give', 'show', 'tell',
  'want', 'need', 'many', 'much', 'best', 'and', 'for', 'to', 'of', 'in', 'on',
]);
const SW_MARKERS = new Set([
  'ya', 'wa', 'na', 'kwa', 'ni', 'je', 'gani', 'nini', 'nataka', 'naomba',
  'nifanye', 'nifanyeje', 'kwenye', 'hii', 'hizi', 'zangu', 'yangu', 'langu',
  'lini', 'wapi', 'vipi', 'jinsi', 'nawezaje', 'kiasi', 'zipi', 'sana',
]);

export function detectLanguage(input: string): 'en' | 'sw' {
  const words = input.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  let en = 0;
  let sw = 0;
  for (const w of words) {
    if (EN_MARKERS.has(w)) en++;
    if (SW_MARKERS.has(w)) sw++;
  }
  // Swahili is the default: this app is Swahili-first, so English needs
  // positive evidence rather than merely an absence of Swahili.
  return en > sw ? 'en' : 'sw';
}

export function normalize(input: string): NormalizedQuery {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  const cleaned = lower.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, ' ').replace(/\s+/g, ' ').trim();

  const weights = new Map<Concept, number>();
  const addConcepts = (concepts: Concept[], weight: number) => {
    for (const c of concepts) {
      weights.set(c, (weights.get(c) ?? 0) + weight);
    }
  };

  // Pass 1 — multi-word forms ("dead stock", "mobile money") consumed first so
  // their unit meaning wins over the individual words.
  // Consumed words are still kept as tokens: they carry surface phrasing that
  // phrase-similarity scoring needs, even though their concepts are already
  // accounted for by the multi-word entry.
  const consumed: string[] = [];
  let working = ` ${cleaned} `;
  for (const phrase of MULTIWORD_FORMS) {
    if (working.includes(` ${phrase} `)) {
      const entry = VOCAB_INDEX.get(phrase)!;
      addConcepts(entry.concepts, entry.weight);
      consumed.push(...phrase.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
      working = working.replace(new RegExp(`\\s${phrase}\\s`, 'g'), ' ');
    }
  }

  // Pass 2 — single tokens.
  const tokens: string[] = [...consumed];
  for (const token of working.trim().split(/\s+/).filter(Boolean)) {
    if (token.length <= 1 || STOP_WORDS.has(token)) continue;
    tokens.push(token);

    const exact = VOCAB_INDEX.get(token);
    if (exact) {
      addConcepts(exact.concepts, exact.weight);
      continue;
    }

    const stemmed = stripPrefix(token);
    if (stemmed) {
      const entry = VOCAB_INDEX.get(stemmed)!;
      addConcepts(entry.concepts, entry.weight * 0.9);
      continue;
    }

    const verb = verbLookup(token);
    if (verb) {
      const entry = VOCAB_INDEX.get(verb)!;
      addConcepts(entry.concepts, entry.weight * 0.9);
      continue;
    }

    const fuzzy = fuzzyLookup(token);
    if (fuzzy) {
      const entry = VOCAB_INDEX.get(fuzzy)!;
      // Typo matches carry less weight than exact hits.
      addConcepts(entry.concepts, entry.weight * 0.75);
    }
  }

  const form = detectForm(cleaned);


  const concepts = new Set(weights.keys());

  return {
    raw,
    cleaned,
    tokens,
    concepts,
    weights,
    form,
    has: (c) => concepts.has(c),
    hasAll: (cs) => cs.every((c) => concepts.has(c)),
    hasAny: (cs) => cs.some((c) => concepts.has(c)),
  };
}
