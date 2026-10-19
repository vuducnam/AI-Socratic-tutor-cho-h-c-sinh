import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFileDeletionSweeper } from '@worker/jobs/file-deletion-sweeper';
import {
  appDb,
  closeTestDatabases,
  countStudentRows,
  studentDataTables,
} from '../../../tests/helpers/test-database';
import { seedStudentEverywhere, type SeededStudent } from '../../../tests/helpers/seed-student-everywhere';

// SPEC §3.1: purge_student() xoá sạch dữ liệu một học sinh ở mọi bảng, học sinh khác nguyên vẹn.
let victim: SeededStudent;
let bystander: SeededStudent;
let tables: string[];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  process.env.STORAGE_DIR = await mkdtemp(join(tmpdir(), 'cu-storage-'));
  victim = await seedStudentEverywhere(appDb());
  bystander = await seedStudentEverywhere(appDb());
  for (const s of [victim, bystander]) {
    for (const uri of s.fileUris) {
      const full = join(process.env.STORAGE_DIR, uri.slice('storage:'.length));
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, 'ảnh giả');
    }
  }
  tables = await studentDataTables();
});
afterAll(closeTestDatabases);

describe('purge_student', () => {
  it('fixture có dữ liệu ở mọi bảng chứa dữ liệu học sinh', async () => {
    expect(tables.length).toBeGreaterThan(25);
    const empty: string[] = [];
    for (const t of tables) if ((await countStudentRows(t, victim.studentId)) === 0) empty.push(t);
    // Bảng mới có student_id mà fixture chưa dựng dữ liệu → fail, để test purge không bỏ sót.
    expect(empty).toEqual([]);
  });

  it('không có purge_request thì lỗi', async () => {
    await expect(
      appDb().query('SELECT purge_student($1)', ['11111111-1111-1111-1111-111111111111']),
    ).rejects.toThrow(/purge_request/);
  });

  it('xoá sạch mọi bảng của học sinh, giữ nguyên học sinh khác, ghi đúng một dòng log', async () => {
    const { rows } = await appDb().query<{ id: string }>(
      'INSERT INTO purge_requests (student_id, requested_by, reason) VALUES ($1, $2, $3) RETURNING id',
      [victim.studentId, victim.parentId, 'phụ huynh yêu cầu'],
    );
    const before: Record<string, number> = {};
    for (const t of tables) before[t] = await countStudentRows(t, bystander.studentId);

    await appDb().query('SELECT purge_student($1)', [rows[0]!.id]);

    for (const t of tables) {
      const n = await countStudentRows(t, victim.studentId);
      // Dòng access_log purge là ngoại lệ duy nhất được giữ lại.
      expect({ t, n }).toEqual({ t, n: t === 'access_log' ? 1 : 0 });
      expect({ t, n: await countStudentRows(t, bystander.studentId) }).toEqual({ t, n: before[t] });
    }
    const log = await appDb().query(
      'SELECT actor_type, actor_id, action, resource FROM access_log WHERE student_id = $1',
      [victim.studentId],
    );
    expect(log.rows).toEqual([
      { actor_type: 'parent', actor_id: victim.parentId, action: 'purge_student', resource: 'all' },
    ]);
  });

  it('trigger append-only bật lại sau purge', async () => {
    await expect(
      appDb().query('DELETE FROM turns WHERE session_id = $1', [bystander.sessionId]),
    ).rejects.toThrow();
  });

  it('sweeper xoá file của học sinh đã purge, không đụng file học sinh khác', async () => {
    const root = process.env.STORAGE_DIR!;
    const path = (uri: string) => join(root, uri.slice('storage:'.length));
    for (const uri of victim.fileUris) expect(await exists(path(uri))).toBe(true);
    const result = await runFileDeletionSweeper();
    expect(result.failed).toBe(0);
    for (const uri of victim.fileUris) expect(await exists(path(uri))).toBe(false);
    for (const uri of bystander.fileUris) expect(await exists(path(uri))).toBe(true);
    const { rows } = await appDb().query(
      'SELECT count(*)::int AS n FROM pending_file_deletions WHERE uri = ANY($1)',
      [victim.fileUris],
    );
    expect(rows[0].n).toBe(0);
  });
});
