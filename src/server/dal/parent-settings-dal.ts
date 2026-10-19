import 'server-only';
import { z } from 'zod';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Cấu hình hồ sơ con do phụ huynh đặt (sở thích đã khai, thời lượng phiên, giới hạn mỗi ngày) và danh
// mục misconception chỉ đọc cho màn hình Duyệt (trạng thái duyệt lấy từ YAML seed).

export const studentPreferencesSchema = z
  .object({
    interests: z.array(z.string().trim().min(1).max(40)).max(10),
    sessionMinutes: z.number().int().min(5).max(60),
    dailyLimitMinutes: z.number().int().min(5).max(180),
  })
  .refine((v) => v.dailyLimitMinutes >= v.sessionMinutes, {
    message: 'Giới hạn mỗi ngày phải lớn hơn hoặc bằng thời lượng một phiên',
    path: ['dailyLimitMinutes'],
  });

export type StudentPreferencesInput = z.infer<typeof studentPreferencesSchema>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Phụ huynh liên kết (hoặc admin) cập nhật cấu hình; giữ nguyên các khoá learning_prefs khác. */
export async function updateStudentPreferences(
  actor: Actor,
  input: { studentId: string; preferences: StudentPreferencesInput },
): Promise<void> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh/admin');
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'students:learning_prefs' });
  const prefs = studentPreferencesSchema.parse(input.preferences);
  const current = await prisma.student.findUniqueOrThrow({ where: { id: input.studentId }, select: { learning_prefs: true } });
  await prisma.student.update({
    where: { id: input.studentId },
    data: {
      interests_declared: [...new Set(prefs.interests)],
      learning_prefs: {
        ...asObject(current.learning_prefs),
        session_minutes: prefs.sessionMinutes,
        daily_limit_minutes: prefs.dailyLimitMinutes,
      },
    },
  });
}

/** Danh mục misconception (không phải dữ liệu học sinh), kèm trạng thái duyệt. */
export async function listMisconceptionCatalog(actor: Actor) {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh/admin');
  return prisma.misconception.findMany({
    orderBy: [{ skill_id: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      skill_id: true,
      description: true,
      probe: true,
      approved_at: true,
      skill: { select: { name: true } },
      approver: { select: { name: true } },
    },
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  updateStudentPreferences: {
    kind: 'student-scoped',
    call: (a, c) =>
      updateStudentPreferences(a, {
        studentId: c.studentId,
        preferences: { interests: ['bóng đá'], sessionMinutes: 15, dailyLimitMinutes: 30 },
      }),
  },
  listMisconceptionCatalog: { kind: 'self-account', call: (a) => listMisconceptionCatalog(a) },
};
