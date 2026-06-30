import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.29.0"

// Gemini proxy.
//
// The API key lives ONLY here, as a Supabase secret (GEMINI_API_KEY), and is
// never shipped to the client bundle. Set it once with:
//   supabase secrets set GEMINI_API_KEY=<your-key>
// and deploy with:
//   supabase functions deploy gemini
//
// Keep verify_jwt enabled (the default) so only authenticated shop users can
// call this — supabase.functions.invoke() automatically attaches the caller's
// access token.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY")
    if (!apiKey) {
      return json({ error: "GEMINI_API_KEY is not configured on the server." })
    }

    const { model, contents, config } = await req.json()
    if (!model || !contents) {
      return json({ error: 'Request must include "model" and "contents".' }, 400)
    }

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({ model, contents, config })

    return json({ text: response.text ?? "" })
  } catch (err) {
    // Forward the underlying message so the client can categorise it
    // (safety / network / overloaded) into a localised user-facing message.
    const message = (err as Error)?.message || "Gemini request failed"
    console.error("[gemini] error:", message)
    return json({ error: message })
  }
})
