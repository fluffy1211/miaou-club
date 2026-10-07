-- Scan before taking the shared restriction counter's row lock. The captured
-- head bounds the cutoff even if new decisions commit during the scan.
CREATE OR REPLACE FUNCTION recovery_prune() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE cutoff bigint; observed_head bigint;
BEGIN
  SELECT head INTO observed_head FROM public.recovery_state WHERE singleton;
  SELECT least(observed_head,coalesce(min(seq)-1,observed_head)) INTO cutoff
    FROM public.recovery_decision
    WHERE created_at >= clock_timestamp()-interval '30 days';
  PERFORM 1 FROM public.recovery_state WHERE singleton FOR UPDATE;
  DELETE FROM public.recovery_decision WHERE seq <= cutoff;
  UPDATE public.recovery_state SET floor=greatest(floor,cutoff) WHERE singleton;
END $$;
