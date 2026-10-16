/**
 * The only place model names live.
 *
 * Providers retire models on their own schedule — `gemini-2.5-flash-lite`
 * started returning "no longer available to new users" with no code change on
 * our side. When that happens the fix should be one edit here, not a hunt
 * through call sites.
 *
 * These names must also appear in the `gemini` Edge Function's allowlist
 * (AI_ALLOWED_MODELS), which refuses anything it does not recognise — so a
 * model changed here without the secret updated fails closed rather than
 * quietly costing money.
 */

/** Reading receipts and shelves. Needs image understanding. */
export const VISION_MODEL = 'gemini-2.5-flash';

/** Short Swahili advice grounded in figures we compute. Cheapest capable model. */
export const CHAT_MODEL = 'gemini-2.5-flash';
