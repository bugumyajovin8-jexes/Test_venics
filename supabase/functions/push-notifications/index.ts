import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.8/mod.ts"

serve(async (req) => {
  try {
    const payload = await req.json()
    const { record, table, type } = payload

    console.log(`Received ${type} on ${table}:`, record.id)

    // Only handle new sales or low stock triggers
    // You can expand this logic for other tables
    if (table !== 'sales' || type !== 'INSERT') {
      return new Response(JSON.stringify({ message: 'Ignored' }), { status: 200 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Get the shop name
    const { data: shop } = await supabase
      .from('shops')
      .select('name')
      .eq('id', record.shop_id)
      .single()

    // 2. Get all users in this shop who have an fcm_token and are bosses/admins
    // We notify the boss/admin when a sale is made
    const { data: users } = await supabase
      .from('users')
      .select('fcm_token, name')
      .eq('shop_id', record.shop_id)
      .in('role', ['boss', 'admin', 'superadmin', 'manager'])
      .not('fcm_token', 'is', null)

    if (!users || users.length === 0) {
      console.log('No FCM tokens found for this shop.')
      return new Response(JSON.stringify({ message: 'No tokens found' }), { status: 200 })
    }

    // 3. Get Google Access Token for FCM
    const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY') || '{}')
    const accessToken = await getGoogleAccessToken(serviceAccount)

    const results = []
    for (const user of users) {
      const message = {
        message: {
          token: user.fcm_token,
          notification: {
            title: `Mauzo Mapya: ${shop?.name || 'Duka Lako'}`,
            body: `Mauzo ya TSh ${record.total_amount.toLocaleString()} yamefanyika sasa hivi.`,
          },
          data: {
            saleId: record.id,
            type: 'new_sale',
            click_action: 'FLUTTER_NOTIFICATION_CLICK'
          },
          android: {
            priority: 'high',
            notification: {
              channel_id: 'sales_notifications',
              icon: 'stock_ticker_update',
              color: '#2563eb',
              sound: 'default'
            }
          }
        }
      }

      const res = await fetch(
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
      
      const result = await res.json()
      results.push({ user: user.name, result })
    }

    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    })
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
