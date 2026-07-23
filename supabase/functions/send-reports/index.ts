import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.8/mod.ts"

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { type } = await req.json()
    console.log(`Processing report type: ${type}`)

    // 1. Get all active shops
    const { data: shops, error: shopsError } = await supabase
      .from('shops')
      .select('id, name')
      .eq('status', 'active')

    if (shopsError) throw shopsError

    // 2. Prepare Firebase Auth
    const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY') || '{}')
    const accessToken = await getGoogleAccessToken(serviceAccount)

    const results = []

    for (const shop of shops) {
      // Calculate time range based on report type
      let startTime = new Date()
      let title = ""
      let body = ""

      if (type === 'pulse_12') {
        // Saa 6 (12 PM) - Covers 6 AM to 12 PM
        startTime.setHours(6, 0, 0, 0)
        title = `⚡ Venics Sales: Taarifa ya Saa 6`
      } else if (type === 'pulse_18') {
        // Saa 12 (6 PM) - Covers 12 PM to 6 PM
        startTime.setHours(12, 0, 0, 0)
        title = `⚡ Venics Sales: Taarifa ya Saa 12`
      } else if (type === 'master_22') {
        // Saa 4 (10 PM) - Full Day
        startTime.setHours(0, 0, 0, 0)
        title = `🏆 RIPOTI YA LEO: Master Report`
      } else {
        continue
      }

      // 3. Calculate Stats for this shop
      const { data: sales } = await supabase
        .from('sales')
        .select('total_amount, total_profit')
        .eq('shop_id', shop.id)
        .eq('is_deleted', false)
        .gte('created_at', startTime.toISOString())

      const revenue = sales?.reduce((acc, s) => acc + s.total_amount, 0) || 0
      const profit = sales?.reduce((acc, s) => acc + s.total_profit, 0) || 0

      // 4. Check Low Stock
      const { count: lowStockCount } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shop.id)
        .eq('is_deleted', false)
        .lte('stock', 5) // Default min_stock is 5

      body = `Habari Boss, katika kipindi hiki:\n💰 Mauzo: ${revenue.toLocaleString()} TZS\n📈 Faida: ${profit.toLocaleString()} TZS\n📦 Bidhaa ${lowStockCount || 0} zimepungua stock.`

      // 5. Get Boss Tokens
      const { data: users } = await supabase
        .from('users')
        .select('fcm_token')
        .eq('shop_id', shop.id)
        .in('role', ['boss', 'admin'])
        .not('fcm_token', 'is', null)

      if (!users || users.length === 0) continue

      // 6. Send Notifications
      for (const user of users) {
        const message = {
          message: {
            token: user.fcm_token,
            notification: { title, body },
            data: { type, shopId: shop.id }
          }
        }

        await fetch(
          `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
          }
        )
      }
      results.push({ shop: shop.name, status: 'sent' })
    }

    return new Response(JSON.stringify({ results }), { status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})

async function getGoogleAccessToken(serviceAccount: any) {
  const jwt = await create(
    { alg: "RS256", typ: "JWT" },
    {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      exp: getNumericDate(3600),
      iat: getNumericDate(0),
    },
    await crypto.subtle.importKey(
      "pkcs8",
      new TextEncoder().encode(
        serviceAccount.private_key.replace(/\\n/g, "\n")
      ),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    )
  )

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  })

  const data = await res.json()
  return data.access_token
}
