import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedStudentEverywhere, type SeededStudent } from '../../../tests/helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../../../tests/helpers/test-database';
import { AuthorizationError } from './actor-authorization';
import { readStudentExport } from './export-dal';
import {
  createIndependentResult,
  independentResultInputSchema,
  listIndependentResults,
  listTopicArms,
  setTopicArm,
  todayInVietnam,
} from './independent-results-dal';
import { mintActor } from './mint-actor';

// Dữ liệu độc lập (SPEC §11.1, §15.15): schema form, phân quyền, và kết quả nhập vào có trong export.

const SKILL_ID = 'TEST.DECIMAL.COMPARE';
const valid = { type: 'class_test' as const, skillIds: [SKILL_ID], score: '8,5', maxScore: '10', note: 'Kiểm tra 15 phút', takenOn: '2026-09-20' };

describe('independentResultInputSchema', () => {
  it('nhận form hợp lệ, đổi dấu phẩy thập phân thành số', () => {
    const r = independentResultInputSchema.parse(valid);
    expect(r).toMatchObject({ type: 'class_test', skillIds: [SKILL_ID], score: 8.5, maxScore: 10, takenOn: '2026-09-20' });
  });

  it('điểm và điểm tối đa không bắt buộc; ô trống thành undefined', () => {
    const r = independentResultInputSchema.parse({ type: 'paper_quiz', score: '', maxScore: '', note: '', takenOn: '2026-09-01' });
    expect(r.score).toBeUndefined();
    expect(r.maxScore).toBeUndefined();
    expect(r.note).toBeUndefined();
    expect(r.skillIds).toEqual([]);
  });

  it.each([
    ['loại không hợp lệ', { ...valid, type: 'exam' }],
    ['điểm lớn hơn điểm tối đa', { ...valid, score: '11' }],
    ['điểm tối đa bằng 0', { ...valid, score: '0', maxScore: '0' }],
    ['điểm âm', { ...valid, score: '-1' }],
    ['điểm không phải số', { ...valid, score: 'tám' }],
    ['quá 2 chữ số thập phân', { ...valid, score: '8,555' }],
    ['có điểm mà thiếu điểm tối đa', { ...valid, maxScore: '' }],
    ['ngày không tồn tại', { ...valid, takenOn: '2026-02-30' }],
    ['ngày sai định dạng', { ...valid, takenOn: '20/09/2026' }],
    ['ngày ở tương lai', { ...valid, takenOn: '2999-01-01' }],
    ['nhận xét của cô không có nội dung', { type: 'teacher_note', note: '  ', takenOn: '2026-09-01' }],
  ])('từ chối: %s', (_label, input) => {
    expect(independentResultInputSchema.safeParse(input).success).toBe(false);
  });

  it('chấp nhận hôm nay theo giờ Việt Nam', () => {
    expect(independentResultInputSchema.safeParse({ ...valid, takenOn: todayInVietnam() }).success).toBe(true);
  });

  it('todayInVietnam dùng múi giờ Asia/Saigon (UTC+7)', () => {
    expect(todayInVietnam(new Date('2026-10-19T18:30:00Z'))).toBe('2026-10-20');
    expect(todayInVietnam(new Date('2026-10-19T16:59:00Z'))).toBe('2026-10-19');
  });
});

describe('independent-results-dal', () => {
  let a: SeededStudent;
  let b: SeededStudent;

  beforeAll(async () => {
    a = await seedStudentEverywhere(appDb());
    b = await seedStudentEverywhere(appDb());
  });
  afterAll(closeTestDatabases);

  it('phụ huynh không liên kết và học sinh bị từ chối', async () => {
    const stranger = mintActor('parent', b.parentId);
    const student = mintActor('student', a.studentId);
    for (const actor of [stranger, student]) {
      await expect(createIndependentResult(actor, { studentId: a.studentId, result: valid })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(listIndependentResults(actor, { studentId: a.studentId })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(listTopicArms(actor, { studentId: a.studentId })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(setTopicArm(actor, { studentId: a.studentId, skillId: SKILL_ID, arm: 'without_cu' })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    }
  });

  it('từ chối skill không có trong danh mục và input sai ngay cả khi gọi thẳng DAL', async () => {
    const parent = mintActor('parent', a.parentId);
    await expect(
      createIndependentResult(parent, { studentId: a.studentId, result: { ...valid, skillIds: ['KHONG.CO'] } }),
    ).rejects.toThrow(/không tồn tại/);
    await expect(
      createIndependentResult(parent, { studentId: a.studentId, result: { ...valid, takenOn: '2999-01-01' } }),
    ).rejects.toThrow();
  });

  it('nhập một điểm → hiện trong danh sách và trong export, entered_by là phụ huynh', async () => {
    const parent = mintActor('parent', a.parentId);
    const id = await createIndependentResult(parent, { studentId: a.studentId, result: valid });

    const listed = await listIndependentResults(parent, { studentId: a.studentId });
    expect(listed.find((r) => r.id === id)).toMatchObject({
      type: 'class_test',
      score: '8.5',
      max_score: '10',
      taken_on: '2026-09-20',
      entered_by: a.parentId,
      skill_ids: [SKILL_ID],
    });

    const exported = await readStudentExport(parent, { studentId: a.studentId });
    const row = exported.independent_results.find((r) => r.id === id);
    expect(row).toMatchObject({ entered_by: a.parentId, note: 'Kiểm tra 15 phút', taken_on: '2026-09-20' });
    expect(Number(row?.score)).toBe(8.5);

    const logged = await appDb().query(
      `SELECT 1 FROM access_log WHERE actor_id = $1 AND student_id = $2 AND action = 'write' AND resource = 'independent_results'`,
      [a.parentId, a.studentId],
    );
    expect(logged.rowCount).toBeGreaterThan(0);
  });

  it('gán nhóm chủ đề là upsert (đổi nhóm không tạo dòng mới)', async () => {
    const parent = mintActor('parent', a.parentId);
    await setTopicArm(parent, { studentId: a.studentId, skillId: SKILL_ID, arm: 'without_cu' });
    let arms = await listTopicArms(parent, { studentId: a.studentId });
    expect(arms.filter((x) => x.skill_id === SKILL_ID).map((x) => x.arm)).toEqual(['without_cu']);
    await setTopicArm(parent, { studentId: a.studentId, skillId: SKILL_ID, arm: 'with_cu' });
    arms = await listTopicArms(parent, { studentId: a.studentId });
    expect(arms.filter((x) => x.skill_id === SKILL_ID).map((x) => x.arm)).toEqual(['with_cu']);
    await expect(
      setTopicArm(parent, { studentId: a.studentId, skillId: SKILL_ID, arm: 'maybe' as 'with_cu' }),
    ).rejects.toThrow();
  });
});
