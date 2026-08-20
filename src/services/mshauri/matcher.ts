/**
 * Skill matcher.
 *
 * Every skill is scored independently and the best one wins. Nothing depends on
 * declaration order, which is the core fix for the old engine's behaviour where
 * the first `if` that happened to match decided the answer.
 *
 * When the top two candidates are too close the matcher refuses to guess and
 * returns a `clarify` outcome instead — the assistant asks rather than being
 * confidently wrong.
 */

import { C } from './concepts';
import { lookupAlias } from './learning';
import { normalize, type NormalizedQuery, type QuestionForm } from './normalize';
import { SKILLS, SKILL_INDEX } from './registry';
import type { Skill, SkillKind, MatchOutcome } from './types';

/** Below this, nothing matched well enough to answer. */
const MIN_SCORE = 2.5;
/** If the top two are closer than this, ask instead of guessing. */
const AMBIGUITY_MARGIN = 1.2;

/**
 * How well each skill kind serves each question form. A "jinsi ya…" question
 * should never be answered with a figure, and "faida ya leo" should never be
 * answered with a tutorial.
 */
const FORM_AFFINITY: Record<QuestionForm, Partial<Record<SkillKind, number>>> = {
  HOWTO:  { howto: 3, action: 1, advice: 0.5, data: -2.5, system: 0 },
  WHERE:  { howto: 3, action: 1, data: -1.5, advice: -1, system: 0 },
  WHY:    { howto: -2, advice: 1.5, data: -1.5, action: 0.5, system: 0 },
  ADVICE: { advice: 3, howto: 0.5, data: -1, action: 0, system: 0 },
  DATA:   { data: 3, action: 1.5, advice: 0.5, howto: -2.5, system: -1 },
  PLAIN:  { data: 1, action: 0.5, howto: 0, advice: 0, system: 0.5 },
};

/** Normalized token sets for each skill's canonical phrases, built once. */
const PHRASE_TOKENS = new Map<string, Set<string>[]>();
for (const skill of SKILLS) {
  PHRASE_TOKENS.set(
    skill.id,
    skill.phrases.map((p) => new Set(normalize(p).tokens)),
  );
}

/** Recall-oriented overlap: how much of a canonical phrase the query covers. */
function phraseSimilarity(skillId: string, queryTokens: string[]): number {
  const sets = PHRASE_TOKENS.get(skillId);
  if (!sets?.length || !queryTokens.length) return 0;

  const query = new Set(queryTokens);
  let best = 0;

  for (const phrase of sets) {
    if (!phrase.size) continue;
    let hits = 0;
    for (const t of phrase) if (query.has(t)) hits++;
    // Reward covering the phrase, with a small bonus for a tight query.
    const recall = hits / phrase.size;
    const precision = hits / query.size;
    const score = recall * 0.75 + precision * 0.25;
    if (score > best) best = score;
  }

  return best;
}

function scoreSkill(skill: Skill, q: NormalizedQuery): number {
  // ---- Hard guards --------------------------------------------------
  if (skill.block?.some((c) => q.has(c))) return 0;
  if (skill.must?.length && !skill.must.every((c) => q.has(c))) return 0;
  if (skill.any?.length && !skill.any.some((c) => q.has(c))) return 0;

  // A skill with no concept requirements at all would match everything.
  if (!skill.must?.length && !skill.any?.length) return 0;

  let score = 0;

  // ---- Concept evidence ----------------------------------------------
  for (const c of skill.must ?? []) score += 1.5 * (q.weights.get(c) ?? 0);
  for (const c of skill.any ?? []) if (q.has(c)) score += 1.2 * (q.weights.get(c) ?? 0);
  for (const c of skill.boost ?? []) if (q.has(c)) score += 0.6 * (q.weights.get(c) ?? 0);

  // Specificity: a skill demanding two concepts and getting both is a
  // stronger signal than one demanding a single common concept.
  const required = (skill.must?.length ?? 0) + (skill.any?.length ? 1 : 0);
  score += Math.min(required, 3) * 0.4;

  // ---- Surface phrasing ------------------------------------------------
  score += phraseSimilarity(skill.id, q.tokens) * 3;

  // ---- Strategic questions belong to the model --------------------------
  // Planning, forecasting and judgement calls ("what should I order?",
  // "budget for next month", "why did sales drop?") cannot be answered by a
  // stored figure or a tutorial. A penalty rather than a hard block, so a very
  // specific match (e.g. "leseni itaisha lini") can still win on its own merit.
  if (q.has(C.GROW) && (skill.kind === 'data' || skill.kind === 'howto')) {
    score -= 3;
  }

  // ---- Question-form fit -----------------------------------------------
  score += FORM_AFFINITY[q.form][skill.kind] ?? 0;
  // Raised from 1: it must be enough for a troubleshooting guide to survive
  // the WHY penalty above, while a generic data/how-to skill does not.
  if (skill.forms?.includes(q.form)) score += 2;

  return Math.max(0, score * (skill.priority ?? 1));
}

const TIME_CONCEPTS = new Set<string>([
  C.TODAY, C.YESTERDAY, C.WEEK, C.MONTH, C.LAST_MONTH, C.SIX_MONTHS,
]);

/** Openers that mark a reply as continuing the previous question. */
const CONNECTIVE = /^(na|je|vipi|kisha|tena|halafu|au|kuhusu|hiyo|hilo|hizo)\b/i;

function isContinuation(q: NormalizedQuery): boolean {
  return CONNECTIVE.test(q.cleaned) || q.tokens.length <= 2;
}

export interface MatchContext {
  /** Skill that answered the previous turn. */
  lastSkillId?: string;
}

export function match(input: string, ctx?: MatchContext): MatchOutcome {
  const q = normalize(input);
  const lastSkill = ctx?.lastSkillId ? SKILL_INDEX.get(ctx.lastSkillId) : undefined;
  const continuing = !!lastSkill && isContinuation(q);

  // A phrasing this shop has already taught us wins outright — that is the
  // whole point of learning it.
  const learned = lookupAlias(input);
  if (learned && !continuing) {
    const skill = SKILL_INDEX.get(learned);
    if (skill) {
      return { type: 'answer', skill, score: MIN_SCORE, alternatives: [], viaAlias: true };
    }
  }

  // "Na mwezi huu?" after a sales report — same question, new period. The
  // caller re-reads the period from the text, so returning the same skill is
  // all that is needed.
  if (continuing && q.concepts.size > 0) {
    const nonTime = [...q.concepts].filter((c) => !TIME_CONCEPTS.has(c));
    if (nonTime.length === 0) {
      return { type: 'answer', skill: lastSkill!, score: MIN_SCORE, alternatives: [] };
    }
  }

  const ranked = SKILLS
    .map((skill) => {
      const base = scoreSkill(skill, q);
      // Stay in the previous topic when the query is clearly a follow-up.
      const bonus = base > 0 && continuing && skill.domain === lastSkill!.domain ? 1.5 : 0;
      return { skill, score: base > 0 ? base + bonus : 0 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length || ranked[0].score < MIN_SCORE) {
    // Even a failed match usually has near-misses worth offering, which turns
    // a dead end into a two-tap recovery.
    return { type: 'unknown', query: input, nearest: ranked.slice(0, 3).map((r) => r.skill) };
  }

  const [top, second] = ranked;

  // Too close to call — ask instead of guessing. Only cross-domain ties are
  // worth a question; two skills in the same domain are close enough that the
  // better-scoring one is a safe pick.
  if (
    second &&
    second.score >= MIN_SCORE &&
    top.score - second.score < AMBIGUITY_MARGIN &&
    top.skill.domain !== second.skill.domain
  ) {
    const candidates = ranked
      .filter((r) => top.score - r.score < AMBIGUITY_MARGIN)
      .slice(0, 3)
      .map((r) => r.skill);

    if (candidates.length > 1) return { type: 'clarify', candidates };
  }

  return {
    type: 'answer',
    skill: top.skill,
    score: top.score,
    alternatives: ranked.slice(1, 4).map((r) => r.skill),
  };
}

export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | '6months';

/** Reporting period named in the query, defaulting to today. */
export function extractPeriod(input: string): Period {
  const q = normalize(input);
  // Checked most-specific first: "mwezi uliopita" also contains "mwezi".
  if (q.has(C.LAST_MONTH)) return 'lastMonth';
  if (q.has(C.SIX_MONTHS)) return '6months';
  if (q.has(C.YESTERDAY)) return 'yesterday';
  if (q.has(C.WEEK)) return 'week';
  if (q.has(C.MONTH)) return 'month';
  return 'today';
}

/** Follow-up chips: the skill's declared relations, phrased as questions. */
export function getFollowUps(skill: Skill): string[] {
  const chips: string[] = [];

  for (const id of skill.related ?? []) {
    const related = SKILL_INDEX.get(id);
    if (!related?.phrases.length) continue;
    const phrase = related.phrases[0];
    chips.push(phrase.charAt(0).toUpperCase() + phrase.slice(1) + '?');
  }

  return chips.slice(0, 3);
}

/** Exposed for the Phase 4 test fixture and for debugging in the console. */
export function debugRank(input: string, limit = 5) {
  const q = normalize(input);
  return {
    form: q.form,
    concepts: [...q.concepts],
    ranked: SKILLS
      .map((skill) => ({ id: skill.id, kind: skill.kind, score: +scoreSkill(skill, q).toFixed(2) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit),
  };
}
