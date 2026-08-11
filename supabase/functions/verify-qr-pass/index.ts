import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { payload, signature, nonce } = await req.json();

    if (!payload || !nonce) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request: missing payload or nonce' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Verify single-use nonce
    const { data: existingNonce } = await supabaseAdmin
      .from('scan_nonces')
      .select('id')
      .eq('nonce', nonce)
      .maybeSingle();

    if (existingNonce) {
      return new Response(
        JSON.stringify({ success: false, error: 'Security Violation: Replayed QR nonce detected' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Validate booking from PostgreSQL
    const bookingId = payload.booking_id || payload.bookingId;
    const { data: booking, error: bookingErr } = await supabaseAdmin
      .from('bookings')
      .select('*, seats(seat_number), profiles!student_id(full_name)')
      .eq('id', bookingId)
      .maybeSingle();

    if (bookingErr || !booking) {
      return new Response(
        JSON.stringify({ success: false, error: 'Booking record not found or invalid' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Store nonce replay tracking record
    await supabaseAdmin.from('scan_nonces').insert({
      nonce,
      booking_id: bookingId,
      scanned_at: new Date().toISOString()
    });

    // 4. Process desk check-in via RPC
    const { data: checkInRes, error: checkInErr } = await supabaseAdmin.rpc('check_in_booking', {
      p_identifier: bookingId,
      p_method: 'qr'
    });

    if (checkInErr) {
      return new Response(
        JSON.stringify({ success: false, error: checkInErr.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        booking_id: bookingId,
        seat_number: booking.seats?.seat_number || 'A-101',
        student_name: booking.profiles?.full_name || 'Student',
        checked_in_at: new Date().toISOString()
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
