-- Append-only restrictions are captured on every SQL/Drizzle/Better Auth path.
CREATE TABLE "recovery_decision" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "recovery_decision_seq" CHECK ("recovery_decision"."seq" > 0),
	CONSTRAINT "recovery_decision_code" CHECK ("recovery_decision"."code" in ('user_remove','user_suspend','user_withdraw','user_demote','credentials_revoke','encounter_remove','encounter_hide','encounter_private','location_remove','friendship_remove','report_remove','report_close'))
);
--> statement-breakpoint
CREATE TABLE "recovery_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"source_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"head" bigint DEFAULT 0 NOT NULL,
	"floor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "recovery_state_bounds" CHECK ("recovery_state"."singleton" and "recovery_state"."floor" >= 0 and "recovery_state"."head" >= "recovery_state"."floor")
);
--> statement-breakpoint
INSERT INTO recovery_state(singleton) VALUES(true);
--> statement-breakpoint
CREATE FUNCTION recovery_record(decision text, target text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE position bigint;
BEGIN
  -- A transactional counter, not a sequence: rollback consumes no position.
  -- The singleton row serializes concurrent writers until their commit.
  UPDATE public.recovery_state SET head=head+1 WHERE singleton RETURNING head INTO position;
  IF position IS NULL THEN RAISE EXCEPTION 'Recovery state missing'; END IF;
  INSERT INTO public.recovery_decision(seq,code,subject) VALUES(position,decision,target);
END $$;
--> statement-breakpoint
CREATE FUNCTION recovery_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE before_row jsonb := to_jsonb(OLD); after_row jsonb := to_jsonb(NEW); target text;
BEGIN
  CASE TG_TABLE_NAME
  WHEN 'user' THEN
    target := coalesce(after_row->>'id',before_row->>'id');
    IF TG_OP='DELETE' THEN PERFORM public.recovery_record('user_remove',target);
    ELSIF TG_OP='UPDATE' AND (before_row->'email' IS DISTINCT FROM after_row->'email'
      OR before_row->'email_verified' IS DISTINCT FROM after_row->'email_verified'
      OR before_row->'two_factor_enabled' IS DISTINCT FROM after_row->'two_factor_enabled')
      THEN PERFORM public.recovery_record('credentials_revoke',target);
    END IF;
  WHEN 'user_policy' THEN
    target := coalesce(after_row->>'user_id',before_row->>'user_id');
    IF TG_OP='DELETE' THEN PERFORM public.recovery_record('user_remove',target);
    ELSE
      IF before_row->'status' IS DISTINCT FROM after_row->'status' THEN
        CASE after_row->>'status'
          WHEN 'deleting' THEN PERFORM public.recovery_record('user_remove',target);
          WHEN 'suspended' THEN PERFORM public.recovery_record('user_suspend',target);
          WHEN 'withdrawn' THEN PERFORM public.recovery_record('user_withdraw',target);
          ELSE NULL;
        END CASE;
      END IF;
      IF before_row->>'admitted'='true' AND after_row->>'admitted'='false'
        THEN PERFORM public.recovery_record('user_withdraw',target); END IF;
      IF before_row->>'role'='admin' AND after_row->>'role'<>'admin'
        THEN PERFORM public.recovery_record('user_demote',target); END IF;
      IF (after_row->>'recovery_pending'='true' AND before_row->'recovery_pending' IS DISTINCT FROM after_row->'recovery_pending')
        OR (before_row->>'recovery_enrolled'='true' AND after_row->>'recovery_enrolled'='false')
        THEN PERFORM public.recovery_record('credentials_revoke',target); END IF;
    END IF;
  WHEN 'encounter' THEN
    target := coalesce(after_row->>'id',before_row->>'id');
    IF TG_OP='DELETE' OR (after_row->>'deleted_at' IS NOT NULL AND before_row->>'deleted_at' IS NULL)
      THEN PERFORM public.recovery_record('encounter_remove',target); END IF;
    IF TG_OP='UPDATE' THEN
      IF after_row->>'hidden'='true' AND before_row->>'hidden'='false'
        THEN PERFORM public.recovery_record('encounter_hide',target); END IF;
      IF after_row->>'visibility'='private' AND before_row->>'visibility'<>'private'
        THEN PERFORM public.recovery_record('encounter_private',target); END IF;
      IF before_row->'location_size' IS DISTINCT FROM after_row->'location_size'
        OR before_row->'location_x' IS DISTINCT FROM after_row->'location_x'
        OR before_row->'location_y' IS DISTINCT FROM after_row->'location_y'
        OR before_row->'location_context' IS DISTINCT FROM after_row->'location_context'
        THEN PERFORM public.recovery_record('location_remove',target); END IF;
    END IF;
  WHEN 'account', 'two_factor' THEN
    target := coalesce(after_row->>'user_id',before_row->>'user_id');
    IF TG_OP<>'UPDATE' OR (before_row - 'updated_at') IS DISTINCT FROM (after_row - 'updated_at') THEN
      PERFORM public.recovery_record('credentials_revoke',target);
      IF TG_OP='UPDATE' AND before_row->'user_id' IS DISTINCT FROM after_row->'user_id'
        THEN PERFORM public.recovery_record('credentials_revoke',before_row->>'user_id'); END IF;
    END IF;
  WHEN 'friendship' THEN
    IF TG_OP='DELETE' THEN PERFORM public.recovery_record('friendship_remove',before_row->>'id'); END IF;
  WHEN 'report' THEN
    target := coalesce(after_row->>'id',before_row->>'id');
    IF TG_OP='DELETE' THEN PERFORM public.recovery_record('report_remove',target);
    ELSIF before_row->>'closed_at' IS NULL AND after_row->>'closed_at' IS NOT NULL
      THEN PERFORM public.recovery_record('report_close',target); END IF;
  ELSE RAISE EXCEPTION 'Unexpected recovery table';
  END CASE;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION recovery_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TRUNCATE bypasses recovery decisions; use transactional DELETE'; END $$;
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['user','user_policy','encounter','account','two_factor','friendship','report'] LOOP
    EXECUTE format('CREATE TRIGGER recovery_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION recovery_capture()',name);
    EXECUTE format('CREATE TRIGGER recovery_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION recovery_no_truncate()',name);
  END LOOP;
END $$;
--> statement-breakpoint
-- Only a contiguous expired prefix can be pruned. Retained backups older than
-- this floor are refused, rather than replayed with missing restrictions.
CREATE FUNCTION recovery_prune() RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE cutoff bigint; current_head bigint;
BEGIN
  SELECT head INTO current_head FROM public.recovery_state WHERE singleton FOR UPDATE;
  SELECT coalesce(min(seq)-1,current_head) INTO cutoff FROM public.recovery_decision WHERE created_at >= clock_timestamp()-interval '30 days';
  DELETE FROM public.recovery_decision WHERE seq <= cutoff;
  UPDATE public.recovery_state SET floor=greatest(floor,cutoff) WHERE singleton;
END $$;
