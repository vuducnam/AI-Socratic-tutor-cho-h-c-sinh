-- purge_student(request_id): xoá toàn bộ dữ liệu của một học sinh (quy tắc cứng 3, SPEC §3.1).
-- - Chỉ chạy khi có purge_requests (DAL tạo sau khi phụ huynh liên kết xác nhận hai bước).
-- - Danh sách bảng lấy từ catalog (FK tới students, trực tiếp hoặc qua nhiều bước, hoặc có cột
--   student_id), không viết tay: bảng mới tự được xoá.
-- - Trong một transaction: gom URI file vào pending_file_deletions, tạm tắt trigger append-only,
--   xoá theo thứ tự FK (bảng con trước), bật lại trigger, ghi một dòng access_log không có nội dung.

-- Điều kiện SQL "dòng thuộc học sinh $1" cho một bảng: OR của mọi đường đi FK tới students và
-- cột student_id trực tiếp. NULL nếu bảng không nối được tới học sinh.
CREATE FUNCTION student_scope_condition(tbl text, depth int DEFAULT 0) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  fk record;
  parts text[] := '{}';
  parent_cond text;
BEGIN
  IF tbl = 'students' THEN
    RETURN 'id = $1';
  END IF;
  IF depth > 8 THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'student_id'
  ) THEN
    parts := parts || 'student_id = $1'::text;
  END IF;

  FOR fk IN
    SELECT a.attname AS col, pc.relname AS parent, pa.attname AS parent_col
    FROM pg_constraint c
    JOIN pg_class cc ON cc.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cc.relnamespace AND n.nspname = 'public'
    JOIN pg_class pc ON pc.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND cc.relname = tbl AND array_length(c.conkey, 1) = 1
      AND pc.relname <> tbl
  LOOP
    parent_cond := student_scope_condition(fk.parent, depth + 1);
    IF parent_cond IS NOT NULL THEN
      parts := parts || format('%I IN (SELECT %I FROM public.%I WHERE %s)',
                               fk.col, fk.parent_col, fk.parent, parent_cond);
    END IF;
  END LOOP;

  IF array_length(parts, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN '(' || array_to_string(parts, ' OR ') || ')';
END;
$$;

-- Các bảng chứa dữ liệu học sinh (để purge và test registry dùng chung một định nghĩa).
CREATE FUNCTION student_data_tables() RETURNS SETOF text
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT t.table_name::text
  FROM information_schema.tables t
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    AND student_scope_condition(t.table_name::text) IS NOT NULL
  ORDER BY 1
$$;

CREATE FUNCTION purge_student(request_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  req purge_requests%ROWTYPE;
  remaining text[];
  tbl text;
  cond text;
  picked text;
  ao text;
BEGIN
  SELECT * INTO req FROM purge_requests WHERE id = request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purge_student: không có purge_request %', request_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- File ảnh xoá sau khi commit, do worker file-deletion-sweeper (có retry).
  INSERT INTO pending_file_deletions (uri)
  SELECT uri FROM (
    SELECT image_uri AS uri FROM problems WHERE student_id = req.student_id
    UNION SELECT image_uri FROM mission_artifacts WHERE student_id = req.student_id
    UNION SELECT document_uri FROM consents WHERE student_id = req.student_id
  ) files
  WHERE uri IS NOT NULL;

  FOREACH ao IN ARRAY append_only_tables() LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', ao, ao || '_append_only');
  END LOOP;

  SELECT array_agg(t) INTO remaining FROM student_data_tables() t;

  -- Xoá bảng con trước: chọn bảng không còn bảng nào khác trong danh sách tham chiếu tới nó.
  WHILE remaining IS NOT NULL AND array_length(remaining, 1) > 0 LOOP
    picked := NULL;
    FOREACH tbl IN ARRAY remaining LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class cc ON cc.oid = c.conrelid
        JOIN pg_class pc ON pc.oid = c.confrelid
        WHERE c.contype = 'f' AND pc.relname = tbl AND cc.relname <> tbl
          AND cc.relname = ANY (remaining)
      ) THEN
        picked := tbl;
        EXIT;
      END IF;
    END LOOP;
    IF picked IS NULL THEN
      RAISE EXCEPTION 'purge_student: vòng FK giữa các bảng %', remaining;
    END IF;
    cond := student_scope_condition(picked);
    EXECUTE format('DELETE FROM public.%I WHERE %s', picked, cond) USING req.student_id;
    remaining := array_remove(remaining, picked);
  END LOOP;

  FOREACH ao IN ARRAY append_only_tables() LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', ao, ao || '_append_only');
  END LOOP;

  -- Dòng log cuối cùng: không chứa nội dung, chỉ ai xoá và học sinh nào.
  INSERT INTO access_log (actor_type, actor_id, student_id, action, resource)
  VALUES ('parent', req.requested_by, req.student_id, 'purge_student', 'all');
END;
$$;

REVOKE ALL ON FUNCTION purge_student(uuid) FROM PUBLIC;
