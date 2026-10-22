import type pg from 'pg';

// Tìm bảng chứa dữ liệu học sinh từ information_schema, độc lập với hàm SQL của purge:
// hợp của (1) có cột student_id, (2) nối được tới students qua đồ thị FK (bao nhiêu bước cũng được).
export async function discoverStudentTables(db: pg.Pool | pg.PoolClient): Promise<string[]> {
  const { rows: cols } = await db.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = 'student_id'`,
  );
  const { rows: fks } = await db.query<{ child: string; parent: string }>(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  );

  const found = new Set<string>(['students', ...cols.map((r) => r.table_name)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { child, parent } of fks) {
      if (child !== parent && found.has(parent) && !found.has(child)) {
        found.add(child);
        grew = true;
      }
    }
  }
  return [...found].sort();
}
