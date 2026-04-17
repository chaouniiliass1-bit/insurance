-- ============================================
-- MOODFUSION PLAYER - Optimized Profiles Table
-- ============================================

-- Note: Run this in your Supabase SQL editor. The DROP is
-- commented for safety; uncomment only if you intend to
-- recreate the table and accept data loss.

-- DROP TABLE IF EXISTS public.profiles CASCADE;

CREATE TABLE IF NOT EXISTS public.profiles (
  -- Primary identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE,
  device_fingerprint TEXT UNIQUE,

  -- User data
  nickname TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  password_hash TEXT NOT NULL,

  -- Gamification
  coins SMALLINT NOT NULL DEFAULT 3 CHECK (coins >= 0),
  is_vip BOOLEAN NOT NULL DEFAULT false,

  -- Contact verification
  whatsapp_number TEXT,
  whatsapp_verified BOOLEAN NOT NULL DEFAULT false,
  verification_code TEXT,
  verification_expires TIMESTAMPTZ,

  -- Session management
  keep_logged_in BOOLEAN NOT NULL DEFAULT false,
  last_login TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES for Performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_profiles_nickname ON public.profiles(nickname) WHERE nickname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_device_id ON public.profiles(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_device_fingerprint ON public.profiles(device_fingerprint) WHERE device_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_verification ON public.profiles(verification_code, verification_expires)
  WHERE verification_code IS NOT NULL AND verification_expires > NOW();
CREATE INDEX IF NOT EXISTS idx_profiles_whatsapp ON public.profiles(whatsapp_number) WHERE whatsapp_number IS NOT NULL;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "anon_select_profiles" ON public.profiles
  FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS "anon_insert_profiles" ON public.profiles
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_update_profiles" ON public.profiles
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "anon_delete_profiles" ON public.profiles
  FOR DELETE TO anon USING (true);

-- ============================================
-- TRIGGERS for Auto-Update
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION clean_expired_verification_codes()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verification_expires IS NOT NULL AND NEW.verification_expires < NOW() THEN
    NEW.verification_code = NULL;
    NEW.verification_expires = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clean_verification_on_update ON public.profiles;
CREATE TRIGGER clean_verification_on_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION clean_expired_verification_codes();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION is_nickname_available(check_nickname TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE nickname = check_nickname
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_profile_by_device(
  p_device_id TEXT DEFAULT NULL,
  p_device_fingerprint TEXT DEFAULT NULL
)
RETURNS SETOF public.profiles AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.profiles
  WHERE (p_device_id IS NOT NULL AND device_id = p_device_id)
     OR (p_device_fingerprint IS NOT NULL AND device_fingerprint = p_device_fingerprint)
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SAMPLE DATA (for testing)
-- ============================================

-- INSERT INTO public.profiles (nickname, device_id, password_hash, coins)
-- VALUES
--   ('test_user', 'device_123', '$2a$10$hashedpassword', 100),
--   ('vip_user', 'device_456', '$2a$10$hashedpassword', 500);