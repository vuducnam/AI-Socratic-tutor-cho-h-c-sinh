import { afterAll, describe, expect, it } from 'vitest';
import { discoverStudentTables } from '../../../tests/helpers/student-table-discovery';
import { closeTestDatabases, ownerDb, studentDataTables } from '../../../tests/helpers/test-database';
import { NON_STUDENT_TABLES, REGISTERED_TABLES, TransparencyRegistry } from './registry';

// Quy tắc cứng 2, SPEC §3.2: mọi bảng có dữ liệu học sinh phải có trong registry, parentView && export.
afterAll(closeTestDatabases);

function registryGaps(discovered: string[]) {
  const registered = new Set<string>(REGISTERED_TABLES);
  return {
    missing: discovered.filter((t) => !registered.has(t)),
    extra: REGISTERED_TABLES.filter((t) => !discovered.includes(t)),
  };
}

describe('TransparencyRegistry', () => {
  it('khớp đúng tập bảng có dữ liệu học sinh trong schema public', async () => {
    const discovered = await discoverStudentTables(ownerDb());
    expect(registryGaps(discovered)).toEqual({ missing: [], extra: [] });
  });

  it('hàm SQL student_data_tables() của purge thấy đúng cùng tập bảng', async () => {
    expect(await studentDataTables()).toEqual(await discoverStudentTables(ownerDb()));
  });

  it('mọi mục có parentView và export bật', () => {
    for (const [table, entry] of Object.entries(TransparencyRegistry)) {
      expect({ table, parentView: entry.parentView, export: entry.export }).toEqual({
        table,
        parentView: true,
        export: true,
      });
    }
  });

  it('mọi bảng trong schema hoặc thuộc registry, hoặc nằm trong danh sách ngoài registry', async () => {
    const { rows } = await ownerDb().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const known = new Set<string>([...REGISTERED_TABLES, ...NON_STUDENT_TABLES]);
    expect(rows.map((r) => r.table_name).filter((t) => !known.has(t))).toEqual([]);
  });

  it('thêm một bảng có student_id mà không đăng ký → bị phát hiện', async () => {
    const client = await ownerDb().connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE public.tmp_unregistered_notes (id serial PRIMARY KEY, student_id uuid)');
      await client.query(
        'CREATE TABLE public.tmp_unregistered_children (id serial PRIMARY KEY, note_id int REFERENCES public.tmp_unregistered_notes(id))',
      );
      const { missing } = registryGaps(await discoverStudentTables(client));
      expect(missing).toEqual(['tmp_unregistered_children', 'tmp_unregistered_notes']);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
