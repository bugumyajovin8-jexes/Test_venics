-- SQL migration/script to register public.assistant_chats table with Supabase
-- This schema consolidates chats, memory, and unresolved questions into a single optimized table
-- Optimized for high performance, indexing, row-level security (RLS), and disk usage prevention.

-- =========================================================================
-- 1. TABLE CREATION
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.assistant_chats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_id text DEFAULT 'default'::text,
  message_type text CHECK (message_type = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])),
  content text NOT NULL,
  is_unresolved boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT assistant_chats_pkey PRIMARY KEY (id),
  CONSTRAINT assistant_chats_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE,
  CONSTRAINT assistant_chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- =========================================================================
-- 2. HIGH PERFORMANCE INDEXING (DISK I/O REDUCTION)
-- =========================================================================
-- Index to fetch message history for a shop query super fast in descending order
CREATE INDEX IF NOT EXISTS idx_assistant_chats_shop_session_datetime 
ON public.assistant_chats (shop_id, session_id, created_at DESC);

-- Index to query only the user_id fast
CREATE INDEX IF NOT EXISTS idx_assistant_chats_user_id 
ON public.assistant_chats (user_id);

-- Partial index for Developer Dashboard to quickly audit UNRESOLVED questions 
-- (extremely fast, zero overhead since it only indexes records where is_unresolved = true)
CREATE INDEX IF NOT EXISTS idx_assistant_chats_unresolved 
ON public.assistant_chats (shop_id, created_at DESC) 
WHERE is_unresolved = true;

-- GIN (Generalized Inverted Index) on the JSONB metadata column for complex searching/filtering on intent/context tags
CREATE INDEX IF NOT EXISTS idx_assistant_chats_metadata_gin 
ON public.assistant_chats USING gin (metadata);


-- =========================================================================
-- 3. STORAGE LIMITING & DISK CLEANUP TRIGGER (CRASH PREVENTION)
-- =========================================================================
-- This trigger automatically prunes old messages when new ones are inserted.
-- It keeps a maximum of 150 records per shop_id to prevent database growth and high disk I/O.
CREATE OR REPLACE FUNCTION public.prune_old_assistant_chats()
RETURNS TRIGGER AS $$
DECLARE
  max_messages_per_shop CONSTANT integer := 150;
  current_count integer;
BEGIN
  -- Count total records for the current shop
  SELECT count(*) INTO current_count 
  FROM public.assistant_chats 
  WHERE shop_id = NEW.shop_id;

  -- If it exceeds our limit, delete the oldest records
  IF current_count > max_messages_per_shop THEN
    DELETE FROM public.assistant_chats
    WHERE id IN (
      SELECT id 
      FROM public.assistant_chats 
      WHERE shop_id = NEW.shop_id
      ORDER BY created_at ASC
      LIMIT (current_count - max_messages_per_shop)
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger so it fires AFTER INSERT on every new chat entry
DROP TRIGGER IF EXISTS trg_prune_old_assistant_chats ON public.assistant_chats;
CREATE TRIGGER trg_prune_old_assistant_chats
  AFTER INSERT ON public.assistant_chats
  FOR EACH ROW
  EXECUTE FUNCTION public.prune_old_assistant_chats();


-- =========================================================================
-- 4. ROW LEVEL SECURITY (RLS) & ACCESS CONTROL POLICIES
-- =========================================================================
-- Enable RLS on the table
ALTER TABLE public.assistant_chats ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can read messages that belong to their own shop_id
CREATE POLICY "Users can view chats of their own shop" 
ON public.assistant_chats
FOR SELECT
TO authenticated
USING (
  shop_id IN (
    SELECT shop_id 
    FROM public.users 
    WHERE id = auth.uid()
  )
);

-- Policy 2: Users can insert new chat messages for their own shop_id
CREATE POLICY "Users can insert chats for their own shop" 
ON public.assistant_chats
FOR INSERT
TO authenticated
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM public.users 
    WHERE id = auth.uid()
  ) AND user_id = auth.uid()
);

-- Policy 3: Users can update their own messages (or devs flag is_unresolved)
CREATE POLICY "Users can update chats of their own shop" 
ON public.assistant_chats
FOR UPDATE
TO authenticated
USING (
  shop_id IN (
    SELECT shop_id 
    FROM public.users 
    WHERE id = auth.uid()
  )
);


-- =========================================================================
-- 5. ROLES & PERMISSIONS GRANTS (SUPABASE API ACCESS)
-- =========================================================================
-- Explicitly grant access to the table to standard Supabase API roles
GRANT ALL ON TABLE public.assistant_chats TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_chats TO authenticated;

-- If you are using real-time or need anonymous access to public tables, 
-- you may optionally grant to anon (disabled here for maximum security, but keep if needed):
-- GRANT SELECT, INSERT ON TABLE public.assistant_chats TO anon;
