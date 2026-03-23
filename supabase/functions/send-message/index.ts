// Choice Properties — Edge Function: send-message
// Allowed callers:
//   • Admin users (admin_roles table)
//   • Authenticated landlords — only for applications on their own properties
// Tenant replies use the submit_tenant_reply() DB RPC (anon-callable) instead.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── Authenticate caller ───────────────────────────────────
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jwt) return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user }, error: authErr } = await authClient.auth.getUser(jwt)
  if (authErr || !user) return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })

  const supabaseCheck = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: adminRow }    = await supabaseCheck.from('admin_roles').select('id').eq('user_id', user.id).maybeSingle()
  const { data: landlordRow } = await supabaseCheck.from('landlords').select('id').eq('user_id', user.id).maybeSingle()
  const isAdmin    = !!adminRow
  const isLandlord = !!landlordRow

  if (!isAdmin && !isLandlord) {
    return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
  // ── End auth check ────────────────────────────────────────

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { app_id, message, sender, sender_name } = await req.json()
    if (!app_id || !message) throw new Error('app_id and message required')

    // Landlords may only message applicants on their own properties
    if (!isAdmin && isLandlord) {
      const { data: appCheck } = await supabase
        .from('applications')
        .select('landlord_id')
        .eq('app_id', app_id)
        .single()
      if (!appCheck || appCheck.landlord_id !== landlordRow!.id) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden — not your property' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
    }

    const { data: app, error: fetchErr } = await supabase.from('applications').select('email,first_name,preferred_language,landlord_id').eq('app_id', app_id).single()
    if (fetchErr) throw new Error(fetchErr.message)

    await supabase.from('messages').insert({ app_id, sender: sender || 'admin', sender_name: sender_name || 'Choice Properties', message })

    // P1-A: Graceful GAS relay check — if not configured, skip email but still return success
    const gasUrl    = Deno.env.get('GAS_EMAIL_URL')
    const gasSecret = Deno.env.get('GAS_RELAY_SECRET')
    if (!gasUrl || !gasSecret) {
      console.warn('GAS_EMAIL_URL or GAS_RELAY_SECRET not configured — email notification skipped')
      return new Response(JSON.stringify({ success: true, warning: 'Email relay not configured' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // P1-A: new_message_tenant — notify tenant when admin or landlord sends a message
    if (sender === 'admin' || sender === 'landlord' || !sender) {
      fetch(gasUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: gasSecret, template: 'new_message_tenant', to: app.email,
          data: { app_id, first_name: app.first_name, message, preferred_language: app.preferred_language || 'en' } })
      }).then(async (r) => {
        const json = await r.json().catch(() => ({}))
        const ok = r.ok && json.success !== false
        await supabase.from('email_logs').insert({ type: 'new_message_tenant', recipient: app.email, status: ok ? 'sent' : 'failed', app_id, error_msg: ok ? null : (json.error || `HTTP ${r.status}`) })
      }).catch(async (e) => {
        await supabase.from('email_logs').insert({ type: 'new_message_tenant', recipient: app.email, status: 'failed', app_id, error_msg: e?.message || 'Network error' })
      })
    }

    // P1-B: new_message_landlord — notify landlord when a tenant message is forwarded by admin.
    // Note: tenants cannot call this endpoint directly (auth guard enforces admin/landlord only).
    // For tenant-initiated replies, cp-api.js tenantReply() calls send-inquiry with type:'tenant_reply'
    // after the DB RPC succeeds. This branch handles the case where an admin relays a tenant message.
    if (sender === 'tenant') {
      if (app.landlord_id) {
        const { data: landlordRow } = await supabase.from('landlords').select('email, contact_name, business_name').eq('id', app.landlord_id).maybeSingle()
        if (landlordRow?.email) {
          const landlordName = landlordRow.business_name || landlordRow.contact_name || 'Landlord'
          fetch(gasUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: gasSecret, template: 'new_message_landlord', to: landlordRow.email,
              data: { app_id, landlordName, tenantName: sender_name || 'Tenant', message } })
          }).then(async (r) => {
            const json = await r.json().catch(() => ({}))
            const ok = r.ok && json.success !== false
            await supabase.from('email_logs').insert({ type: 'new_message_landlord', recipient: landlordRow.email, status: ok ? 'sent' : 'failed', app_id, error_msg: ok ? null : (json.error || `HTTP ${r.status}`) })
          }).catch(async (e) => {
            await supabase.from('email_logs').insert({ type: 'new_message_landlord', recipient: landlordRow.email, status: 'failed', app_id, error_msg: e?.message || 'Network error' })
          })
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
