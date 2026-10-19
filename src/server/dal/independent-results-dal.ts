import 'server-only';
import { z } from 'zod';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Dữ liệu độc lập (SPEC §11.1, §15.15): điểm trên lớp, bài giấy, nhận xét cô do phụ huynh nhập, và việc
// gán từng skill vào nhóm with_cu / without_cu. Là dữ liệu nền cho so sánh trong hệ thống với bên ngoài.

export const INDEPENDENT_RESULT_TYPES = ['class_test', 'paper_quiz', 'teacher_note'] as const;
export const TOPIC_ARMS = ['with_cu', 'without_cu'] as const;
export type TopicArmValue = (typeof TOPIC_ARMS)[number];

const MAX_SCORE_VALUE = 999_999.99; // numeric(8,2)

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function todayInVietnam(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function isRealDate(value: string): boolean {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Ô trống → undefined; chấp nhận dấu phẩy thập phân kiểu Việt ("8,5").
const optionalScore = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'number') return v;
    const text = String(v).trim();
    return text === '' ? undefined : Number(text.replace(',', '.'));
  },
  z
    .number({ error: 'Điểm phải là số' })
    .finite('Điểm phải là số')
    .min(0, 'Điểm không được âm')
    .max(MAX_SCORE_VALUE, 'Điểm quá lớn')
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Tối đa 2 chữ số thập phân')
    .optional(),
);

/** Schema form nhập dữ liệu độc lập (dùng ở Server Action và kiểm lại trong DAL). */
export const independentResultInputSchema = z
  .object({
    type: z.enum(INDEPENDENT_RESULT_TYPES, { error: 'Chọn loại kết quả' }),
    skillIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    score: optionalScore,
    maxScore: optionalScore,
    note: z
      .string()
      .trim()
      .max(2000, 'Ghi chú tối đa 2000 ký tự')
      .optional()
      .transform((v) => (v ? v : undefined)),
    takenOn: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ')
      .refine(isRealDate, 'Ngày không hợp lệ')
      .refine((v) => v <= todayInVietnam(), 'Ngày làm bài không được ở tương lai'),
  })
  .superRefine((v, ctx) => {
    if (v.maxScore !== undefined && v.maxScore <= 0) {
      ctx.addIssue({ code: 'custom', path: ['maxScore'], message: 'Điểm tối đa phải lớn hơn 0' });
    }
    if (v.score !== undefined && v.maxScore === undefined) {
      ctx.addIssue({ code: 'custom', path: ['maxScore'], message: 'Có điểm thì cần nhập điểm tối đa' });
    }
    if (v.score !== undefined && v.maxScore !== undefined && v.score > v.maxScore) {
      ctx.addIssue({ code: 'custom', path: ['score'], message: 'Điểm không được lớn hơn điểm tối đa' });
    }
    if (v.type === 'teacher_note' && !v.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Nhận xét của cô cần có nội dung' });
    }
  });

export type IndependentResultInput = z.input<typeof independentResultInputSchema>;

function assertParentOrAdmin(actor: Actor): asserts actor is Actor<'parent' | 'admin'> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh/admin');
}

async function assertSkillsExist(skillIds: string[]): Promise<void> {
  if (skillIds.length === 0) return;
  const found = await prisma.skill.count({ where: { skill_id: { in: skillIds } } });
  if (found !== new Set(skillIds).size) throw new Error('Có kỹ năng không tồn tại trong danh mục');
}

/** Danh mục skill để chọn trong form (không phải dữ liệu học sinh). */
export async function listSkillCatalog(input: { grade?: number } = {}) {
  return prisma.skill.findMany({
    where: input.grade ? { grade_introduced: input.grade } : {},
    orderBy: [{ subject: 'asc' }, { skill_id: 'asc' }],
    select: { skill_id: true, subject: true, grade_introduced: true, name: true },
  });
}

export async function createIndependentResult(
  actor: Actor,
  input: { studentId: string; result: IndependentResultInput },
): Promise<string> {
  assertParentOrAdmin(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'independent_results' });
  const data = independentResultInputSchema.parse(input.result);
  const skillIds = [...new Set(data.skillIds)];
  await assertSkillsExist(skillIds);
  const row = await prisma.independentResult.create({
    data: {
      student_id: input.studentId,
      type: data.type,
      skill_ids: skillIds,
      score: data.score ?? null,
      max_score: data.maxScore ?? null,
      note: data.note ?? null,
      taken_on: new Date(`${data.takenOn}T00:00:00Z`),
      entered_by: actor.id,
    },
    select: { id: true },
  });
  return row.id;
}

export async function listIndependentResults(actor: Actor, input: { studentId: string }) {
  assertParentOrAdmin(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'independent_results' });
  const rows = await prisma.independentResult.findMany({
    where: { student_id: input.studentId },
    orderBy: [{ taken_on: 'desc' }, { created_at: 'desc' }],
    include: { enterer: { select: { name: true } } },
  });
  return rows.map((r) => ({
    ...r,
    score: r.score === null ? null : r.score.toString(),
    max_score: r.max_score === null ? null : r.max_score.toString(),
    taken_on: r.taken_on.toISOString().slice(0, 10),
  }));
}

export async function listTopicArms(actor: Actor, input: { studentId: string }) {
  assertParentOrAdmin(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'topic_arms' });
  return prisma.topicArm.findMany({ where: { student_id: input.studentId }, orderBy: { skill_id: 'asc' } });
}

export async function setTopicArm(actor: Actor, input: { studentId: string; skillId: string; arm: TopicArmValue }): Promise<void> {
  assertParentOrAdmin(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: `topic_arms:${input.skillId}` });
  const arm = z.enum(TOPIC_ARMS).parse(input.arm);
  await assertSkillsExist([input.skillId]);
  await prisma.topicArm.upsert({
    where: { student_id_skill_id: { student_id: input.studentId, skill_id: input.skillId } },
    create: { student_id: input.studentId, skill_id: input.skillId, arm },
    update: { arm, assigned_at: new Date() },
  });
}

const FIXTURE_SKILL_ID = 'TEST.DECIMAL.COMPARE';

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  todayInVietnam: { kind: 'no-actor', reason: 'hàm thuần tính ngày theo giờ Việt Nam' },
  listSkillCatalog: { kind: 'no-actor', reason: 'danh mục skill SGK, không chứa dữ liệu học sinh' },
  createIndependentResult: {
    kind: 'student-scoped',
    call: (a, c) =>
      createIndependentResult(a, {
        studentId: c.studentId,
        result: { type: 'paper_quiz', skillIds: [], score: 7, maxScore: 10, takenOn: '2026-01-05' },
      }),
  },
  listIndependentResults: { kind: 'student-scoped', call: (a, c) => listIndependentResults(a, { studentId: c.studentId }) },
  listTopicArms: { kind: 'student-scoped', call: (a, c) => listTopicArms(a, { studentId: c.studentId }) },
  setTopicArm: {
    kind: 'student-scoped',
    call: (a, c) => setTopicArm(a, { studentId: c.studentId, skillId: FIXTURE_SKILL_ID, arm: 'with_cu' }),
  },
};
