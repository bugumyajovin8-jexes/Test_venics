import { supabase } from '../supabase';

export interface GeminiProxyRequest {
  model: string;
  contents: any;
  config?: Record<string, any>;
}

/**
 * Calls Gemini through the `gemini` Supabase Edge Function so the API key never
 * reaches the client bundle. Returns a minimal shape compatible with the
 * @google/genai SDK response (`{ text }`) so existing call sites need no change
 * beyond swapping the client.
 */
/**
 * A refusal from one of the proxy's own guards (quota, kill switch, size cap).
 *
 * These carry a `reason` and a message that is ALREADY written for the shop
 * owner, so callers must surface it as-is rather than running it through their
 * generic error translators — otherwise "you've reached today's limit" gets
 * rewritten as "the photo was unreadable".
 */
export class GeminiGuardError extends Error {
  reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'GeminiGuardError';
    this.reason = reason;
  }
}

export async function generateContent(req: GeminiProxyRequest): Promise<{ text: string }> {
  const { data, error } = await supabase.functions.invoke('gemini', { body: req });

  // A genuine non-2xx (e.g. auth failure, quota). Try to surface the function's
  // JSON error body so the caller's error translators get a meaningful message.
  if (error) {
    let detail = error.message;
    let reason: string | undefined;
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
        if (body?.reason) reason = body.reason;
      }
    } catch {
      /* keep the original error message */
    }
    if (reason) throw new GeminiGuardError(detail, reason);
    throw new Error(detail || 'Gemini proxy request failed');
  }

  // The function returns 200 with `{ error }` for app-level failures so the
  // message text is preserved for categorisation.
  if (data?.error) {
    if (data.reason) throw new GeminiGuardError(data.error, data.reason);
    throw new Error(data.error);
  }

  return { text: data?.text ?? '' };
}
