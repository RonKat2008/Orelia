-- Owner-only case deletion: removing a case must remove everything that hangs off it.
-- Re-create every foreign key that points at cases / contacts / tasks with ON DELETE CASCADE.
-- Generic on purpose (looks constraints up in the catalog) so it is idempotent and independent of constraint names.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname,
           con.conrelid::regclass AS child,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confdeltype <> 'c'
      AND con.connamespace = 'public'::regnamespace
      AND con.confrelid IN ('public.cases'::regclass, 'public.contacts'::regclass, 'public.tasks'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.child, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE', r.child, r.conname,
      regexp_replace(r.def, ' ON DELETE [A-Z ]+$', ''));
  END LOOP;
END $$;
