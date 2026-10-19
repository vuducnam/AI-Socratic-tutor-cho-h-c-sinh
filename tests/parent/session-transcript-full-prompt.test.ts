import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { mintActor } from '@/server/dal/mint-actor';
import { PurgeConfirmationError, purgeStudentData } from '@/server/dal/parent-data-dal';
import { getSessionTranscript } from '@/server/dal/parent-views-dal';
import { seedStudentEverywhere, type SeededStudent } from '../helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../helpers/test-database';

// SPEC §15.13: với một phiên bất kỳ, phụ huynh mở được prompt đầy đủ đã gửi đi của từng lượt, cùng
// response thô và guard verdict (cả checker='code' lẫn 'llm'). Purge từ phía phụ huynh xoá sạch hồ sơ.

let seeded: SeededStudent;

beforeAll(async () => {
  seeded = await seedStudentEverywhere(appDb());
});
afterAll(closeTestDatabases);

describe('transcript phiên cho phụ huynh', () => {
  it('mọi llm_calls của mỗi lượt có request (prompt) và response nguyên văn như trong DB', async () => {
    const parent = mintActor('parent', seeded.parentId);
    const t = await getSessionTranscript(parent, { studentId: seeded.studentId, sessionId: seeded.sessionId });
    expect(t.turns.map((x) => x.id)).toEqual(seeded.turnIds);

    const { rows } = await appDb().query<{ id: string; turn_id: string | null; request: unknown; response: unknown }>(
      `SELECT id, turn_id, request, response FROM llm_calls WHERE turn_id = ANY($1::uuid[])`,
      [seeded.turnIds],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      const shown = t.llmCalls.find((c) => c.id === row.id);
      expect(shown, `llm_call ${row.id} phải hiện cho phụ huynh`).toBeDefined();
      expect(shown?.turn_id).toBe(row.turn_id);
      expect(shown?.request).toEqual(row.request);
      expect(shown?.response ?? null).toEqual(row.response);
    }
    // Lượt gọi trong phiên nhưng không gắn lượt (pre-solver) cũng hiện.
    expect(t.llmCalls.some((c) => c.purpose === 'presolve' && c.turn_id === null)).toBe(true);
    expect(t.llmCalls.find((c) => c.purpose === 'tutor')?.request).toEqual({ messages: [] });
  });

  it('guard verdict của lượt gồm cả checker code và llm, kèm lý do', async () => {
    const parent = mintActor('parent', seeded.parentId);
    const t = await getSessionTranscript(parent, { studentId: seeded.studentId, sessionId: seeded.sessionId });
    const ofTurn = t.guardVerdicts.filter((v) => v.turn_id === seeded.turnIds[1]);
    expect(ofTurn.map((v) => v.checker).sort()).toEqual(['code', 'llm']);
    expect(ofTurn.find((v) => v.checker === 'code')).toMatchObject({ verdict: 'block', reasons: ['LENGTH'] });
    expect(t.problems.some((p) => p.confirmed_text === 'So sánh 0,45 và 0,5' && p.image_uri?.startsWith('storage:'))).toBe(true);
    expect(t.problems.flatMap((p) => p.solution_plans)).toHaveLength(1);
    expect(t.feedback?.rating).toBe('fun');
    expect(t.session.scope_snapshot).toEqual({});
  });

  it('mỗi lần mở transcript ghi access_log; học sinh và phụ huynh khác bị từ chối', async () => {
    const parent = mintActor('parent', seeded.parentId);
    await getSessionTranscript(parent, { studentId: seeded.studentId, sessionId: seeded.sessionId });
    const logged = await appDb().query(
      `SELECT 1 FROM access_log WHERE actor_id = $1 AND student_id = $2 AND resource = $3`,
      [seeded.parentId, seeded.studentId, `sessions:${seeded.sessionId}`],
    );
    expect(logged.rowCount).toBeGreaterThan(0);

    const other = await seedStudentEverywhere(appDb());
    await expect(
      getSessionTranscript(mintActor('parent', other.parentId), { studentId: seeded.studentId, sessionId: seeded.sessionId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // Chính học sinh cũng không xem được: transcript có lời giải dự tính và đáp án.
    await expect(
      getSessionTranscript(mintActor('student', seeded.studentId), { studentId: seeded.studentId, sessionId: seeded.sessionId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // Phiên của học sinh khác qua studentId của mình → không có phiên này.
    await expect(
      getSessionTranscript(parent, { studentId: seeded.studentId, sessionId: other.sessionId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('purge từ phía phụ huynh', () => {
  it('sai tên gọi → không xoá; đúng tên → hồ sơ và liên kết biến mất, còn một dòng log purge', async () => {
    const victim = await seedStudentEverywhere(appDb());
    const parent = mintActor('parent', victim.parentId);

    await expect(purgeStudentData(parent, { studentId: victim.studentId, confirmDisplayName: 'Bé Khác' })).rejects.toBeInstanceOf(
      PurgeConfirmationError,
    );
    expect((await appDb().query('SELECT 1 FROM students WHERE id = $1', [victim.studentId])).rowCount).toBe(1);

    await expect(
      purgeStudentData(mintActor('admin', victim.adminId, 'kiểm tra'), { studentId: victim.studentId, confirmDisplayName: 'Bé Test' }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await purgeStudentData(parent, { studentId: victim.studentId, confirmDisplayName: ' Bé Test ', reason: 'thử xoá' });
    expect((await appDb().query('SELECT 1 FROM students WHERE id = $1', [victim.studentId])).rowCount).toBe(0);
    expect((await appDb().query('SELECT 1 FROM sessions WHERE student_id = $1', [victim.studentId])).rowCount).toBe(0);
    expect((await appDb().query('SELECT 1 FROM parent_student WHERE student_id = $1', [victim.studentId])).rowCount).toBe(0);
    const log = await appDb().query<{ action: string }>('SELECT action FROM access_log WHERE student_id = $1', [victim.studentId]);
    expect(log.rows.map((r) => r.action)).toEqual(['purge_student']);
  });
});
