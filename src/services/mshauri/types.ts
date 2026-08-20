import type { Concept } from './concepts';
import type { QuestionForm } from './normalize';

export type SkillKind =
  | 'howto'    // static walkthrough + deep link
  | 'data'     // computed from the shop's own numbers
  | 'action'   // renders an inline interactive widget
  | 'advice'   // strategic analysis
  | 'system';  // greetings, help, fallback

/** Where the "take me there" button lands the user. */
export interface Destination {
  route: string;
  /**
   * `data-tour` attribute of the exact control to highlight on arrival.
   * Consumed in Phase 3 by the spotlight hook; harmless until then.
   */
  spotlight?: string;
  label: string;
}

export interface Skill {
  id: string;
  kind: SkillKind;
  domain: string;
  /** Human-readable label, used in disambiguation chips. */
  title: string;
  /** Canonical example questions. Matched by token overlap, not regex. */
  phrases: string[];
  /** ALL of these concepts must be present, or the skill is disqualified. */
  must?: Concept[];
  /** At least ONE of these must be present, or the skill is disqualified. */
  any?: Concept[];
  /** Supporting concepts — each present one adds score. */
  boost?: Concept[];
  /** If ANY of these are present the skill is disqualified. */
  block?: Concept[];
  /** Question forms this skill is designed to answer. Matching form adds score. */
  forms?: QuestionForm[];
  /** Static markdown answer (howto / system skills). */
  answer?: string;
  destination?: Destination;
  /** Skill ids offered as follow-up chips. Validated by the registry. */
  related?: string[];
  /**
   * For `data` / `action` skills: the handler key MshauriChat switches on.
   * Keeps the registry free of React and Dexie imports.
   */
  handler?: string;
  /** Nudges a skill up or down globally. Default 1. */
  priority?: number;
}

export interface SkillMatch {
  skill: Skill;
  score: number;
}

export type MatchOutcome =
  | { type: 'answer'; skill: Skill; score: number; alternatives: Skill[]; viaAlias?: boolean }
  | { type: 'clarify'; candidates: Skill[] }
  /** `nearest` holds skills that scored above zero but below the answer
   *  threshold — offered as "did you mean…?" and logged for triage. */
  | { type: 'unknown'; query: string; nearest: Skill[] };
