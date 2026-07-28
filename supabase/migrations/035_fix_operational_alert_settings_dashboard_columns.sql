begin;

DO $$
BEGIN
  IF to_regclass('public.operational_alert_settings') IS NULL THEN
    RAISE NOTICE 'Table public.operational_alert_settings does not exist; skipping dashboard schema fix.';
    RETURN;
  END IF;

  ALTER TABLE public.operational_alert_settings
    ADD COLUMN IF NOT EXISTS priority_inspection_pending_minutes integer;

  ALTER TABLE public.operational_alert_settings
    ADD COLUMN IF NOT EXISTS export_waiting_collection_hours integer;

  UPDATE public.operational_alert_settings
  SET priority_inspection_pending_minutes = 60
  WHERE priority_inspection_pending_minutes IS NULL;

  UPDATE public.operational_alert_settings
  SET export_waiting_collection_hours = 24
  WHERE export_waiting_collection_hours IS NULL;

  ALTER TABLE public.operational_alert_settings
    ALTER COLUMN priority_inspection_pending_minutes SET DEFAULT 60;

  ALTER TABLE public.operational_alert_settings
    ALTER COLUMN export_waiting_collection_hours SET DEFAULT 24;

  ALTER TABLE public.operational_alert_settings
    ALTER COLUMN priority_inspection_pending_minutes SET NOT NULL;

  ALTER TABLE public.operational_alert_settings
    ALTER COLUMN export_waiting_collection_hours SET NOT NULL;
END
$$;

commit;
