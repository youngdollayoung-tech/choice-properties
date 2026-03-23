// Choice Properties — Edge Function: get-application-status
// Rate-limited wrapper around the get_application_status() DB RPC.
// Rate limit: 10 requests per IP per minute (brute-force protection).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── In-memory rate-limit store ────────────────────────────────
const RATE_LIMIT_MAX    = 10;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in ms

const ipStore = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = ipStore.get(ip);
  if (!rec || now - rec.windowStart > RATE_LIMIT_WINDOW) {
    ipStore.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (rec.count >= RATE_LIMIT_MAX) return true;
  rec.count++;
  return false;
}

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── Rate-limit check ──────────────────────────────────────
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }),
      { status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' } }
    );
  }
  // ── End rate-limit check ──────────────────────────────────

  try {
    let body: any = {};
    try { body = await req.json() } catch (_) { /* empty body */ }

    const { app_id } = body;
    if (!app_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'app_id required' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // Use the service-role key so the RPC can always bypass RLS, regardless
    // of whether the caller is authenticated or anonymous.  The same admin
    // client is reused below for signed-URL generation to avoid a second init.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await supabaseAdmin.rpc('get_application_status', { p_app_id: app_id });
    if (error) throw new Error(error.message);

    // ── Generate a fresh signed URL for the lease PDF if stored as a path ──
    if (data?.application?.lease_pdf_url && !data.application.lease_pdf_url.startsWith('http')) {
      const { data: signed } = await supabaseAdmin.storage
        .from('lease-pdfs')
        .createSignedUrl(data.application.lease_pdf_url, 604800);
      if (signed?.signedUrl) data.application.lease_pdf_url = signed.signedUrl;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
})
