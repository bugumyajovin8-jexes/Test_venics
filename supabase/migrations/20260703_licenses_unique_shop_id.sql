-- One license row per shop.
--
-- Renewals UPDATE the existing row's expiry_date in place (they never insert a new
-- row), so one-row-per-shop is the intended model. This migration enforces it at the
-- database level, which closes the rare race where two concurrent init-license calls
-- could both INSERT a trial for a brand-new shop before either saw the other.
--
-- Safe to run more than once (idempotent). Run it in the Supabase SQL editor.

-- 1. Remove any accidental duplicate rows, keeping the most current one per shop
--    (furthest expiry, then most recently created). Normally there are no duplicates,
--    so this deletes nothing — it just guarantees step 2 can apply cleanly.
DELETE FROM public.licenses l
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY shop_id
           ORDER BY expiry_date DESC, created_at DESC, id DESC
         ) AS rn
  FROM public.licenses
) ranked
WHERE l.id = ranked.id
  AND ranked.rn > 1;

-- 2. Enforce one license row per shop going forward.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'licenses_shop_id_key'
  ) THEN
    ALTER TABLE public.licenses
      ADD CONSTRAINT licenses_shop_id_key UNIQUE (shop_id);
  END IF;
END $$;
