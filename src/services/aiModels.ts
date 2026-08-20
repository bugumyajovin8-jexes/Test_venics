/**
 * The only place model names live.
 *
 * Providers retire models on their own schedule — `gemini-2.5-flash-lite`
 * started returning "no longer available to new users" with no code change on
 * our side. When that happens the fix should be one edit here, not a hunt
 * through call sites, and the Edge Function's allowlist is env-driven so it can
 * follow without a redeploy.
 *
 * To see what your key can actually use:
 *   curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=KEY" | grep '"name"'
 */

/** Reading receipts and shelves. Needs image understanding. */
export const VISION_MODEL = 'gemini-2.5-flash';

/** Short Swahili advice grounded in figures we compute. Cheapest capable model. */
export const CHAT_MODEL = 'gemini-2.5-flash';
