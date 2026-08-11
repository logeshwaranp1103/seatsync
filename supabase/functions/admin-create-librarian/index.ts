// Supabase Edge Function: admin-create-librarian
// Securely creates librarian accounts (Auth + Profile + Audit Log) restricted to active Admins

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  fullName: string;
  email: string;
  staffId: string;
  phone?: string;
  libraryId?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Validate Bearer Token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // Client initialized with user's JWT to verify identity
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user: callerUser }, error: userError } = await userClient.auth.getUser();

    if (userError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired admin token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service-role client for administrative operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Verify Caller Profile & Admin Privilege
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role, status")
      .eq("id", callerUser.id)
      .single();

    if (profileError || !callerProfile) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Caller profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerRole = String(callerProfile.role || "").toLowerCase();
    const callerStatus = String(callerProfile.status || "").toLowerCase();

    if (!["admin", "super_admin"].includes(callerRole) || callerStatus !== "active") {
      // Audit log unauthorized attempt
      await adminClient.from("audit_logs").insert({
        actor_id: callerUser.id,
        event_type: "UNAUTHORIZED_LIBRARIAN_ACCESS",
        metadata: { attempted_action: "CREATE_LIBRARIAN", role: callerRole, status: callerStatus },
      });

      return new Response(
        JSON.stringify({ error: "Forbidden: Only active administrators can create librarian accounts" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Parse & Validate Payload
    const body: RequestBody = await req.json();
    const { fullName, email, staffId, phone, libraryId } = body;

    if (!fullName || !fullName.trim()) {
      return new Response(
        JSON.stringify({ error: "Full Name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return new Response(
        JSON.stringify({ error: "Valid official email address is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanStaffId = String(staffId || "").trim();
    if (!cleanStaffId) {
      return new Response(
        JSON.stringify({ error: "Staff ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Check for duplicates in public.profiles
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("email, staff_id")
      .or(`email.eq.${cleanEmail},staff_id.eq.${cleanStaffId},login_identifier.eq.${cleanStaffId.toLowerCase()}`)
      .maybeSingle();

    if (existingProfile) {
      if (existingProfile.email?.toLowerCase() === cleanEmail) {
        return new Response(
          JSON.stringify({ error: "An account with this email address already exists" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "An account with this Staff ID already exists" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Generate secure temporary password or invite user
    const tempPassword = `Staff#${Math.random().toString(36).slice(-6)}!${Math.floor(100 + Math.random() * 900)}`;

    // Create Supabase Auth account
    const { data: authData, error: createAuthError } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
        staff_id: cleanStaffId,
        role: "librarian",
      },
    });

    if (createAuthError || !authData?.user) {
      return new Response(
        JSON.stringify({ error: `Auth account creation failed: ${createAuthError?.message || "Unknown error"}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const createdUserId = authData.user.id;

    // 6. Create matching profiles record (Role forced to 'librarian')
    const { error: insertProfileError } = await adminClient
      .from("profiles")
      .upsert({
        id: createdUserId,
        full_name: fullName.trim(),
        email: cleanEmail,
        staff_id: cleanStaffId,
        login_identifier: cleanStaffId.toLowerCase(),
        role: "librarian",
        status: "active",
        phone: phone ? phone.trim() : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertProfileError) {
      // Rollback Auth user if profile creation fails
      await adminClient.auth.admin.deleteUser(createdUserId);
      return new Response(
        JSON.stringify({ error: `Profile record creation failed: ${insertProfileError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Write Audit Log Event
    await adminClient.from("audit_logs").insert({
      actor_id: callerUser.id,
      target_id: createdUserId,
      event_type: "LIBRARIAN_CREATED",
      metadata: {
        full_name: fullName.trim(),
        email: cleanEmail,
        staff_id: cleanStaffId,
        assigned_library_id: libraryId || null,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Librarian account created successfully. An invitation has been sent.",
        user: {
          id: createdUserId,
          fullName: fullName.trim(),
          email: cleanEmail,
          staffId: cleanStaffId,
          role: "librarian",
          accountStatus: "active",
          tempPassword,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
