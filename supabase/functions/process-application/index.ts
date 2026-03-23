// Choice Properties — Edge Function: process-application
// Receives application form POST, saves to Supabase, fires emails via GAS relay
// Rate limiting: max 5 submissions per IP per 10 minutes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── In-memory rate-limit store ────────────────────────────────
const RATE_LIMIT_MAX    = 5;
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes in ms

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ── Rate-limit check ──────────────────────────────────────
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return new Response(
      JSON.stringify({ error: 'Too many submissions. Please try again later.' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '600' } }
    );
  }
  // ── End rate-limit check ──────────────────────────────────

  // ── Optional applicant auth — link submission to authenticated user ──
  // If the applicant is signed in via OTP, their JWT is forwarded by the
  // browser via callEdgeFunction(). We verify it here and save their user_id
  // on the application record. This is purely additive — anonymous
  // submissions continue to work unchanged.
  let applicantUserId: string | null = null
  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (jwt && jwt !== Deno.env.get('SUPABASE_ANON_KEY')) {
      const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
      const { data: { user } } = await authClient.auth.getUser(jwt)
      if (user?.id) applicantUserId = user.id
    }
  } catch (_) { /* non-fatal — continue without linking */ }
  // ── End optional auth ─────────────────────────────────────

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const formData = await req.json()

    // ── Duplicate submission guard ────────────────────────
    // Two checks:
    //   A) Active application (pending/under_review/approved) for same email+property — show recovery banner
    //   B) Hard block: same email+property submitted within 24 hours — prevents spam
    const submittedEmail    = (formData['Email'] || formData.email || '').toLowerCase().trim()
    const submittedProperty = formData.listing_property_id || null
    const submittedAddress  = (formData['Property Address'] || formData.property_address || '').trim()

    if (submittedEmail) {
      // Check A: active application for same email + property (by ID or address)
      if (submittedProperty || submittedAddress) {
        let activeQuery = supabase
          .from('applications')
          .select('app_id, status, created_at')
          .ilike('email', submittedEmail)
          .in('status', ['pending', 'under_review', 'approved'])
          .order('created_at', { ascending: false })
          .limit(1)
        if (submittedProperty) {
          activeQuery = activeQuery.eq('property_id', submittedProperty)
        } else {
          activeQuery = activeQuery.ilike('property_address', submittedAddress)
        }
        const { data: activeApp } = await activeQuery
        if (activeApp && activeApp.length > 0) {
          return new Response(
            JSON.stringify({
              success: false,
              duplicate: true,
              existing_app_id: activeApp[0].app_id,
              error: 'You already have an active application for this property.',
            }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      // Check B: hard block — same email+property within 24 hours (spam prevention)
      const oneDayAgo = new Date(Date.now() - 86400000).toISOString()
      let recentQuery = supabase
        .from('applications')
        .select('app_id')
        .eq('email', submittedEmail)
        .gte('created_at', oneDayAgo)
      if (submittedProperty) recentQuery = recentQuery.eq('property_id', submittedProperty)
      const { data: recentApp } = await recentQuery.limit(1)
      if (recentApp && recentApp.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'A recent application from this email already exists. Please wait 24 hours before reapplying, or contact us if you need help.',
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // ── Validate property is still active at time of submission ──
    // Prevents applications being submitted for properties that were taken
    // off the market between when the applicant started the form and when they submitted.
    if (submittedProperty) {
      const { data: activeProp, error: propCheckError } = await supabase
        .from('properties')
        .select('id, status, title')
        .eq('id', submittedProperty)
        .single()
      if (propCheckError || !activeProp || activeProp.status !== 'active') {
        return new Response(
          JSON.stringify({
            success: false,
            property_inactive: true,
            error: 'This property is no longer available for applications.',
          }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      // Store title for email payload below
      formData._property_title = activeProp.title || ''
    }

    // Generate app_id
    const { data: appIdRow } = await supabase.rpc('generate_app_id')
    const appId = appIdRow || `CP-${Date.now()}`

    // ── Security: Mask SSN to last-4 digits only ──────────
    // Full SSNs must never be stored in plain text.
    // We keep only the last 4 for identity reference.
    function maskSSN(raw: any): string | null {
      if (!raw) return null
      const digits = String(raw).replace(/\D/g, '')
      if (digits.length < 4) return null
      return 'XXX-XX-' + digits.slice(-4)
    }
    formData['SSN']              = maskSSN(formData['SSN']              || formData.ssn)
    formData['Co-Applicant SSN'] = maskSSN(formData['Co-Applicant SSN'] || formData.co_applicant_ssn)
    formData.ssn                 = formData['SSN']
    formData.co_applicant_ssn    = formData['Co-Applicant SSN']

    // ── Build application record ──────────────────────────
    const record = {
      app_id:                           appId,
      status:                           'pending',
      payment_status:                   'unpaid',
      lease_status:                     'none',
      application_fee:                  parseInt(formData.application_fee) || 0,
      property_id:                      formData.listing_property_id || null,
      // landlord_id is derived server-side from the property record, not trusted from the client.
      // This prevents a malicious actor from forging a landlordId URL param to spam another landlord.
      landlord_id:                      null, // resolved below
      property_address:                 formData['Property Address'] || formData.property_address || '',
      first_name:                       formData['First Name'] || formData.first_name || '',
      last_name:                        formData['Last Name'] || formData.last_name || '',
      email:                            formData['Email'] || formData.email || '',
      phone:                            formData['Phone'] || formData.phone || '',
      dob:                              formData['DOB'] || formData.dob || null,
      ssn:                              formData['SSN'] || formData.ssn || null,
      requested_move_in_date:           formData['Requested Move-in Date'] || formData.requested_move_in_date || null,
      desired_lease_term:               formData['Desired Lease Term'] || formData.desired_lease_term || null,
      current_address:                  formData['Current Address'] || formData.current_address || null,
      residency_duration:               formData['Residency Duration'] || formData.residency_duration || null,
      current_rent_amount:              formData['Current Rent Amount'] || formData.current_rent_amount || null,
      reason_for_leaving:               formData['Reason for leaving'] || formData.reason_for_leaving || null,
      current_landlord_name:            formData['Current Landlord Name'] || formData.current_landlord_name || null,
      landlord_phone:                   formData['Landlord Phone'] || formData.landlord_phone || null,
      employment_status:                formData['Employment Status'] || formData.employment_status || null,
      employer:                         formData['Employer'] || formData.employer || null,
      job_title:                        formData['Job Title'] || formData.job_title || null,
      employment_duration:              formData['Employment Duration'] || formData.employment_duration || null,
      supervisor_name:                  formData['Supervisor Name'] || formData.supervisor_name || null,
      supervisor_phone:                 formData['Supervisor Phone'] || formData.supervisor_phone || null,
      monthly_income:                   formData['Monthly Income'] || formData.monthly_income || null,
      other_income:                     formData['Other Income'] || formData.other_income || null,
      reference_1_name:                 formData['Reference 1 Name'] || formData.reference_1_name || null,
      reference_1_phone:                formData['Reference 1 Phone'] || formData.reference_1_phone || null,
      reference_2_name:                 formData['Reference 2 Name'] || formData.reference_2_name || null,
      reference_2_phone:                formData['Reference 2 Phone'] || formData.reference_2_phone || null,
      emergency_contact_name:           formData['Emergency Contact Name'] || formData.emergency_contact_name || null,
      emergency_contact_phone:          formData['Emergency Contact Phone'] || formData.emergency_contact_phone || null,
      emergency_contact_relationship:   formData['Emergency Contact Relationship'] || formData.emergency_contact_relationship || null,
      primary_payment_method:           formData['Primary Payment Method'] || formData.primary_payment_method || null,
      primary_payment_method_other:     formData['Primary Payment Method Other'] || formData.primary_payment_method_other || null,
      alternative_payment_method:       formData['Alternative Payment Method'] || formData.alternative_payment_method || null,
      alternative_payment_method_other: formData['Alternative Payment Method Other'] || formData.alternative_payment_method_other || null,
      third_choice_payment_method:      formData['Third Choice Payment Method'] || formData.third_choice_payment_method || null,
      third_choice_payment_method_other:formData['Third Choice Payment Method Other'] || formData.third_choice_payment_method_other || null,
      has_pets:                         formData['Has Pets'] === 'Yes' || formData.has_pets === true,
      pet_details:                      formData['Pet Details'] || formData.pet_details || null,
      total_occupants:                  formData['Total Occupants'] || formData.total_occupants || null,
      additional_occupants:             formData['Additional Occupants'] || formData.additional_occupants || null,
      ever_evicted:                     formData['Ever Evicted'] === 'Yes' || formData.ever_evicted === true,
      smoker:                           formData['Smoker'] === 'Yes' || formData.smoker === true,
      preferred_language:                formData.preferred_language || 'en',
      preferred_contact_method:         Array.isArray(formData['Preferred Contact Method']) ? formData['Preferred Contact Method'].join(', ') : (formData.preferred_contact_method || null),
      preferred_time:                   Array.isArray(formData['Preferred Time']) ? formData['Preferred Time'].join(', ') : (formData.preferred_time || null),
      preferred_time_specific:          formData['Preferred Time Specific'] || formData.preferred_time_specific || null,
      vehicle_make:                     formData['Vehicle Make'] || formData.vehicle_make || null,
      vehicle_model:                    formData['Vehicle Model'] || formData.vehicle_model || null,
      vehicle_year:                     formData['Vehicle Year'] || formData.vehicle_year || null,
      vehicle_license_plate:            formData['Vehicle License Plate'] || formData.vehicle_license_plate || null,
      has_co_applicant:                 formData['Has Co-Applicant'] === 'Yes' || formData.has_co_applicant === true,
      additional_person_role:           formData['Additional Person Role'] || formData.additional_person_role || null,
      co_applicant_first_name:          formData['Co-Applicant First Name'] || formData.co_applicant_first_name || null,
      co_applicant_last_name:           formData['Co-Applicant Last Name'] || formData.co_applicant_last_name || null,
      co_applicant_email:               formData['Co-Applicant Email'] || formData.co_applicant_email || null,
      co_applicant_phone:               formData['Co-Applicant Phone'] || formData.co_applicant_phone || null,
      co_applicant_dob:                 formData['Co-Applicant DOB'] || formData.co_applicant_dob || null,
      co_applicant_ssn:                 formData['Co-Applicant SSN'] || formData.co_applicant_ssn || null,
      co_applicant_employer:              formData['Co-Applicant Employer'] || formData.co_applicant_employer || null,
      co_applicant_job_title:             formData['Co-Applicant Job Title'] || formData.co_applicant_job_title || null,
      co_applicant_monthly_income:        formData['Co-Applicant Monthly Income'] || formData.co_applicant_monthly_income || null,
      co_applicant_employment_duration:   formData['Co-Applicant Employment Duration'] || formData.co_applicant_employment_duration || null,
      co_applicant_employment_status:     formData['Co-Applicant Employment Status'] || formData.co_applicant_employment_status || null,
      co_applicant_consent:               formData['Co-Applicant Consent'] === true || formData.co_applicant_consent === true,
      document_url:                     formData.document_url || null,
      // Link to authenticated applicant account (null for anonymous submissions)
      applicant_user_id:                applicantUserId,
      // ── Phase 2 new fields ────────────────────────────────
      landlord_email:               formData['Landlord Email']               || formData.landlord_email               || null,
      government_id_type:           formData['Government ID Type']           || formData.government_id_type           || null,
      government_id_number:         formData['Government ID Number']         || formData.government_id_number         || null,
      previous_address:             formData['Previous Address']             || formData.previous_address             || null,
      previous_residency_duration:  formData['Previous Residency Duration']  || formData.previous_residency_duration  || null,
      previous_landlord_name:       formData['Previous Landlord Name']       || formData.previous_landlord_name       || null,
      previous_landlord_phone:      formData['Previous Landlord Phone']      || formData.previous_landlord_phone      || null,
      has_bankruptcy:               formData['Has Bankruptcy'] === 'Yes'     || formData.has_bankruptcy === true,
      bankruptcy_explanation:       formData['Bankruptcy Explanation']       || formData.bankruptcy_explanation       || null,
      has_criminal_history:         formData['Has Criminal History'] === 'Yes' || formData.has_criminal_history === true,
      criminal_history_explanation: formData['Criminal History Explanation'] || formData.criminal_history_explanation || null,
      employer_address:             formData['Employer Address']             || formData.employer_address             || null,
      employment_start_date:        formData['Employment Start Date']        || formData.employment_start_date        || null,
    }

    // Resolve landlord_id server-side from the property record (never trust client-supplied value)
    if (record.property_id) {
      const { data: propForLandlord } = await supabase
        .from('properties')
        .select('landlord_id')
        .eq('id', record.property_id)
        .single()
      if (propForLandlord?.landlord_id) {
        record.landlord_id = propForLandlord.landlord_id
      }
    }

    // Insert application
    const { error: insertError } = await supabase
      .from('applications')
      .insert(record)

    if (insertError) throw new Error(`DB insert failed: ${insertError.message}`)

    // Log email attempt
    await supabase.from('email_logs').insert({ type: 'application_confirmation', recipient: record.email, status: 'pending', app_id: appId })

    // P1-A/B/C: Graceful GAS relay check — if not configured, skip all emails but still return success
    const gasUrl    = Deno.env.get('GAS_EMAIL_URL')
    const gasSecret = Deno.env.get('GAS_RELAY_SECRET')
    if (!gasUrl || !gasSecret) {
      console.warn('GAS_EMAIL_URL or GAS_RELAY_SECRET not configured — email notifications skipped')
      return new Response(JSON.stringify({ success: true, app_id: appId, warning: 'Email relay not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Sanitized payload — only what email templates actually need
    // Never send SSN, DOB, employer, income, references, or emergency contacts to GAS relay
    const emailPayload = {
      app_id:              appId,
      first_name:          record.first_name,
      last_name:           record.last_name,
      email:               record.email,
      phone:               record.phone,
      property_title:      formData._property_title     || '',
      property_address:    record.property_address,
      application_fee:     record.application_fee,
      requested_move_in:   record.requested_move_in_date || 'Not specified',
      desired_lease_term:  record.desired_lease_term     || 'Not specified',
    }

    // Applicant confirmation
    fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: gasSecret, template: 'application_confirmation', to: record.email, data: emailPayload })
    }).then(async (r) => {
      const json = await r.json().catch(() => ({}))
      const ok = r.ok && json.success !== false
      await supabase.from('email_logs').insert({ type: 'application_confirmation', recipient: record.email, status: ok ? 'success' : 'failed', app_id: appId, error_msg: ok ? null : (json.error || `HTTP ${r.status}`) })
    }).catch(async (e) => {
      await supabase.from('email_logs').insert({ type: 'application_confirmation', recipient: record.email, status: 'failed', app_id: appId, error_msg: e?.message || 'Network error' })
    })

    // Admin notification — pass admin email from env secrets
    const adminEmail = Deno.env.get('ADMIN_EMAIL') || Deno.env.get('ADMIN_EMAILS') || null;
    fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: gasSecret, template: 'admin_notification', to: adminEmail, data: emailPayload })
    }).then(async (r) => {
      const json = await r.json().catch(() => ({}))
      const ok = r.ok && json.success !== false
      await supabase.from('email_logs').insert({ type: 'admin_notification', recipient: adminEmail || 'admin', status: ok ? 'success' : 'failed', app_id: appId, error_msg: ok ? null : (json.error || `HTTP ${r.status}`) })
    }).catch(async (e) => {
      await supabase.from('email_logs').insert({ type: 'admin_notification', recipient: adminEmail || 'admin', status: 'failed', app_id: appId, error_msg: e?.message || 'Network error' })
    })

    // P1-C: new_application — notify landlord when a new application is submitted for their property
    if (record.property_id) {
      const { data: propRow } = await supabase
        .from('properties')
        .select('landlords(email, contact_name, business_name)')
        .eq('id', record.property_id)
        .single()
      const landlordEmail = (propRow as any)?.landlords?.email
      const landlordName  = (propRow as any)?.landlords?.business_name || (propRow as any)?.landlords?.contact_name || 'Landlord'
      if (landlordEmail) {
        const landlordPayload = {
          ...emailPayload,
          landlordName,
          app_id: appId,
          applicantName: `${record.first_name} ${record.last_name}`,
          propertyAddress: record.property_address,
        }
        // Send with 'new_application' template (P1-C) — also try legacy 'landlord_notification' as fallback alias
        fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: gasSecret, template: 'new_application', to: landlordEmail, data: landlordPayload })
        }).then(async (r) => {
          const json = await r.json().catch(() => ({}))
          const ok = r.ok && json.success !== false
          await supabase.from('email_logs').insert({ type: 'new_application', recipient: landlordEmail, status: ok ? 'success' : 'failed', app_id: appId, error_msg: ok ? null : (json.error || `HTTP ${r.status}`) })
          // If GAS doesn't recognise the new template yet, fall back to the legacy template name
          if (!ok) {
            fetch(gasUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret: gasSecret, template: 'landlord_notification', to: landlordEmail, data: landlordPayload })
            }).catch(() => {})
          }
        }).catch(async (e) => {
          await supabase.from('email_logs').insert({ type: 'new_application', recipient: landlordEmail, status: 'failed', app_id: appId, error_msg: e?.message || 'Network error' })
        })
      }
    }

    // Co-applicant notification — inform them they were listed on the application
    if (record.co_applicant_email) {
      const coApplicantPayload = {
        app_id:            appId,
        primary_applicant: `${record.first_name} ${record.last_name}`,
        property_address:  record.property_address,
      }
      await supabase.from('email_logs').insert({ type: 'co_applicant_notification', recipient: record.co_applicant_email, status: 'pending', app_id: appId })
      fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: gasSecret, template: 'co_applicant_notification', to: record.co_applicant_email, data: coApplicantPayload })
      }).then(async (r) => {
        const json = await r.json().catch(() => ({}))
        const ok = r.ok && json.success !== false
        await supabase.from('email_logs').insert({ type: 'co_applicant_notification', recipient: record.co_applicant_email, status: ok ? 'success' : 'failed', app_id: appId, error_msg: ok ? null : (json.error || `HTTP ${r.status}`) })
      }).catch(async (e) => {
        await supabase.from('email_logs').insert({ type: 'co_applicant_notification', recipient: record.co_applicant_email, status: 'failed', app_id: appId, error_msg: e?.message || 'Network error' })
      })
    }

    return new Response(JSON.stringify({ success: true, app_id: appId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
