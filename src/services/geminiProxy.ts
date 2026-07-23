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
export async function generateContent(req: GeminiProxyRequest): Promise<{ text: string }> {
  const { data, error } = await supabase.functions.invoke('gemini', { body: req });

  // A genuine non-2xx (e.g. auth failure). Try to surface the function's JSON
  // error body so the caller's error translators get a meaningful message.
  if (error) {
    let detail = error.message;
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch {
      /* keep the original error message */
    }
    throw new Error(detail || 'Gemini proxy request failed');
  }

  // The function returns 200 with `{ error }` for app-level failures so the
  // message text is preserved for categorisation.
  if (data?.error) {
    throw new Error(data.error);
  }

  return { text: data?.text ?? '' };
}
