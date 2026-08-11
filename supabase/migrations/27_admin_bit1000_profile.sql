-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 27: ADMIN PROFILE BIT1000 INTEGRATION
-- ====================================================================

DO $$
DECLARE
    v_user_id UUID;
    v_email TEXT := 'admin@bitsathy.ac.in';
    v_admin_id TEXT := 'BIT1000';
    v_pass TEXT := '123456';
BEGIN
    -- Check if user already exists in auth.users
    SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = LOWER(v_email);

    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid();

        INSERT INTO auth.users (
            id,
            instance_id,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            aud,
            role,
            created_at,
            updated_at
        ) VALUES (
            v_user_id,
            '00000000-0000-0000-0000-000000000000'::uuid,
            v_email,
            crypt(v_pass, gen_salt('bf')),
            NOW(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('full_name', 'System Administrator', 'admin_id', v_admin_id),
            'authenticated',
            'authenticated',
            NOW(),
            NOW()
        );
    ELSE
        -- Update password if user exists
        UPDATE auth.users 
        SET encrypted_password = crypt(v_pass, gen_salt('bf')),
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            updated_at = NOW()
        WHERE id = v_user_id;
    END IF;

    -- Upsert public.profiles entry for Admin
    INSERT INTO public.profiles (
        id,
        full_name,
        email,
        admin_id,
        login_identifier,
        registration_number,
        department,
        role,
        status,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        'System Administrator',
        v_email,
        v_admin_id,
        v_admin_id,
        v_admin_id,
        'IT & Systems Administration',
        'admin'::user_role,
        'active'::account_status,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        admin_id = EXCLUDED.admin_id,
        login_identifier = EXCLUDED.login_identifier,
        registration_number = EXCLUDED.registration_number,
        department = EXCLUDED.department,
        role = 'admin'::user_role,
        status = 'active'::account_status,
        updated_at = NOW();

END $$;
