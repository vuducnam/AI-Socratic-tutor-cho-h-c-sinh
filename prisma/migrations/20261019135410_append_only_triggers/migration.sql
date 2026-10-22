-- Log bất biến (quy tắc cứng 3, SPEC §3.1). Chỉ purge_student() được xoá, bằng cách tạm tắt trigger
-- trong transaction của nó. TRUNCATE không kích hoạt trigger UPDATE/DELETE nên có trigger riêng.

-- Danh sách bảng append-only: nguồn duy nhất cho trigger, grant, purge_student() và test.
CREATE FUNCTION append_only_tables() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['turns', 'llm_calls', 'guard_verdicts', 'mastery_events',
               'label_corrections', 'access_log', 'school_progress_events']::text[]
$$;

CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % là append-only: không được %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY append_only_tables() LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()',
      t || '_no_truncate', t);
  END LOOP;
END;
$$;
