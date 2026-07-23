import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// init-license — issues a 14-day free trial for a newly created shop.
//
// Security model:
//   - JWT verification is ENABLED (default). The caller must be authenticated.
//   - The shop_id is read from the server-side `users` table using the caller's
//     verified user ID from the JWT — never trusted from the request body.
//   - License INSERT uses the service_role key so RLS cannot be bypassed by the client.
//   - Idempotent: calling it when a license already exists simply returns it.
//   - superadmin role is blocked from calling this endpoint.
//
// Deploy:
//   supabase functions deploy init-license
//
// Required Supabase secrets (already present for other functions):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

const TRIAL_DAYS = 14

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!

    // Verify the caller is authenticated via their JWT
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Unauthorized" }, 401)

    // Use the caller's own token to get their verified identity
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: "Unauthorized" }, 401)

    // Use service_role to read users and write licenses (bypasses RLS)
    const admin = createClient(supabaseUrl, serviceRoleKey)

    // Fetch the caller's shop_id and role from the server — never from the request
    const { data: userData, error: userErr } = await admin
      .from("users")
      .select("shop_id, role")
      .eq("id", user.id)
      .maybeSingle()

    if (userErr || !userData) return json({ error: "User record not found." }, 404)

    // Superadmin must never use this app or its functions
    if (userData.role === "superadmin") return json({ error: "Unauthorized" }, 403)

    if (!userData.shop_id) return json({ error: "Shop not set up yet." }, 400)

    const shopId = userData.shop_id

    // Check if a license already exists — trial creation is idempotent
    const { data: existing, error: readErr } = await admin
      .from("licenses")
      .select("*")
      .eq("shop_id", shopId)
      .maybeSingle()

    if (readErr) {
      console.error("[init-license] Error reading existing license:", readErr)
      return json({ error: "Database error." }, 500)
    }

    if (existing) {
      // License already exists (trial or paid) — return it without modification
      return json({ license: existing, created: false })
    }

    // No license yet — create a 14-day trial using service_role
    const now = new Date()
    const expiryDate = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)

    const { data: newLicense, error: createErr } = await admin
      .from("licenses")
      .insert({
        shop_id: shopId,
        status: "active",
        expiry_date: expiryDate.toISOString(),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select()
      .single()

    if (createErr) {
      // A concurrent init-license call may have inserted the trial first. With the
      // UNIQUE(shop_id) constraint that second insert fails with 23505 — in that case
      // return the now-existing license instead of erroring, so the losing race is graceful.
      if ((createErr as { code?: string }).code === "23505") {
        const { data: raced } = await admin
          .from("licenses")
          .select("*")
          .eq("shop_id", shopId)
          .maybeSingle()
        if (raced) return json({ license: raced, created: false })
      }
      console.error("[init-license] Failed to create trial:", createErr)
      return json({ error: "Imeshindwa kuanzisha leseni ya majaribio." }, 500)
    }

    return json({ license: newLicense, created: true, trial: true })
  } catch (err) {
    const message = (err as Error)?.message || "init-license failed"
    console.error("[init-license] unexpected error:", message)
    return json({ error: message }, 500)
  }
})
