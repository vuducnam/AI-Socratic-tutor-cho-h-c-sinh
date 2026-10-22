-- Quyền của cu_app (app + worker). Role tạo ở docker/postgres-init, không trong migration (SPEC §3.1).
-- cu_app chỉ SELECT, INSERT trên bảng append-only; không TRUNCATE bảng nào.

GRANT USAGE ON SCHEMA public TO cu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cu_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cu_app;
DO $$
DECLARE
  t text;
BEGIN
  -- Shadow DB của `migrate dev` không có bảng _prisma_migrations.
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE _prisma_migrations FROM cu_app;
  END IF;
  FOREACH t IN ARRAY append_only_tables() LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM cu_app', t);
  END LOOP;
END;
$$;

-- Bảng tạo ở migration sau tự có quyền; migration tạo bảng append-only mới phải REVOKE như trên.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cu_app;

GRANT EXECUTE ON FUNCTION purge_student(uuid) TO cu_app;
