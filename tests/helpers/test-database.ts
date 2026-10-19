import pg from 'pg';

// DB test thật (không mock): database cu_test, role cu_app như app; cu_owner cho thao tác quản trị test.
let appPool: pg.Pool | undefined;
let ownerPool: pg.Pool | undefined;

function requireTestUrl(name: 'DATABASE_URL' | 'DATABASE_OWNER_URL'): string {
  const url = process.env[name];
  if (!url) throw new Error(`${name} chưa đặt (xem .env.test.example)`);
  // Chặn chạy nhầm test trên DB thật của con.
  if (!/\/cu_test(\?|$)/.test(url)) throw new Error(`${name} phải trỏ tới database cu_test`);
  return url;
}

export function appDb(): pg.Pool {
  appPool ??= new pg.Pool({ connectionString: requireTestUrl('DATABASE_URL'), max: 4 });
  return appPool;
}

export function ownerDb(): pg.Pool {
  ownerPool ??= new pg.Pool({ connectionString: requireTestUrl('DATABASE_OWNER_URL'), max: 2 });
  return ownerPool;
}

export async function closeTestDatabases(): Promise<void> {
  await Promise.all([appPool?.end(), ownerPool?.end()]);
  appPool = undefined;
  ownerPool = undefined;
}

export async function studentDataTables(): Promise<string[]> {
  const { rows } = await ownerDb().query<{ t: string }>('SELECT student_data_tables() AS t');
  return rows.map((r) => r.t);
}

export async function appendOnlyTables(): Promise<string[]> {
  const { rows } = await ownerDb().query<{ t: string[] }>('SELECT append_only_tables() AS t');
  return rows[0]?.t ?? [];
}

// Đếm số dòng thuộc học sinh trong một bảng, dùng đúng điều kiện mà purge_student() dùng.
export async function countStudentRows(table: string, studentId: string): Promise<number> {
  const { rows: condRows } = await ownerDb().query<{ c: string | null }>(
    'SELECT student_scope_condition($1) AS c',
    [table],
  );
  const cond = condRows[0]?.c;
  if (!cond) throw new Error(`Bảng ${table} không nối được tới students`);
  const { rows } = await ownerDb().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public."${table}" WHERE ${cond}`,
    [studentId],
  );
  return Number(rows[0]?.n ?? 0);
}
