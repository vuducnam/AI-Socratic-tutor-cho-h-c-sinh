import 'server-only';
import { z } from 'zod';
import { appendActorAccessLog } from './access-log-dal';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import type { Prisma } from './generated/client';
import { readVoicePrefs, studentVoicePrefsSchema, type StudentVoicePrefs } from './voice-prefs-dal';

// Cấu hình hồ sơ con do phụ huynh đặt (sở thích đã khai, thời lượng phiên, giới hạn mỗi ngày) và danh
// mục misconception chỉ đọc cho màn hình Duyệt (trạng thái duyệt lấy từ YAML seed). Cài đặt giọng nói
// (tự đọc, ngôn ngữ nói, cho phép STT cloud) cũng do phụ huynh đặt ở đây.

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

type LearningPrefsPatch = Record<string, string | number | boolean>;

/**
 * Gộp `patch` vào students.learning_prefs bằng một câu UPDATE (`||` của JSONB): hai lần lưu cài đặt gần
 * nhau (thời lượng phiên và giọng nói) không ghi đè khoá của nhau như kiểu đọc → sửa → ghi cả object.
 */
async function mergeLearningPrefs(db: Pick<Prisma.TransactionClient, '$executeRaw'>, studentId: string, patch: LearningPrefsPatch): Promise<void> {
  const updated = await db.$executeRaw`
    UPDATE students
    SET learning_prefs = coalesce(learning_prefs, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = now()
    WHERE id = ${studentId}::uuid`;
  if (updated !== 1) throw new AuthorizationError('Không có học sinh này');
}

/** Phụ huynh liên kết (hoặc admin) cập nhật cấu hình; giữ nguyên các khoá learning_prefs khác. */
export async function updateStudentPreferences(
  actor: Actor,
  input: { studentId: string; preferences: StudentPreferencesInput },
): Promise<void> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh/admin');
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'students:learning_prefs' });
  const prefs = studentPreferencesSchema.parse(input.preferences);
  await prisma.$transaction(async (tx) => {
    await tx.student.update({ where: { id: input.studentId }, data: { interests_declared: [...new Set(prefs.interests)] } });
    await mergeLearningPrefs(tx, input.studentId, {
      session_minutes: prefs.sessionMinutes,
      daily_limit_minutes: prefs.dailyLimitMinutes,
    });
  });
}

/**
 * Phụ huynh liên kết (hoặc admin) đặt cài đặt giọng nói; giữ nguyên các khoá learning_prefs khác.
 * Bật/tắt STT cloud (giọng con có thể rời PC, quy tắc cứng 10) ghi thêm một dòng access_log riêng
 * `students:voice_prefs:stt_cloud_fallback=on|off` khi giá trị thật sự đổi, để phụ huynh thấy ai đổi và
 * lúc nào. Dòng log nằm cùng transaction với thay đổi: không có thay đổi nào mà thiếu log.
 */
export async function updateStudentVoicePrefs(actor: Actor, input: { studentId: string; prefs: StudentVoicePrefs }): Promise<void> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh/admin');
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'students:learning_prefs' });
  const prefs = studentVoicePrefsSchema.parse(input.prefs);
  await prisma.$transaction(async (tx) => {
    // Khoá dòng để giá trị "trước" đúng với lần ghi này dù hai phụ huynh lưu cùng lúc.
    const before = await tx.$queryRaw<{ learning_prefs: unknown }[]>`
      SELECT learning_prefs FROM students WHERE id = ${input.studentId}::uuid FOR UPDATE`;
    if (!before[0]) throw new AuthorizationError('Không có học sinh này');
    await mergeLearningPrefs(tx, input.studentId, {
      tts_autoplay: prefs.ttsAutoplay,
      stt_cloud_fallback: prefs.sttCloudFallback,
      stt_language: prefs.sttLanguage,
    });
    if (readVoicePrefs(before[0].learning_prefs).sttCloudFallback !== prefs.sttCloudFallback) {
      await appendActorAccessLog(
        actor,
        {
          studentId: input.studentId,
          action: 'write',
          resource: `students:voice_prefs:stt_cloud_fallback=${prefs.sttCloudFallback ? 'on' : 'off'}`,
        },
        tx,
      );
    }
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
  updateStudentVoicePrefs: {
    kind: 'student-scoped',
    call: (a, c) =>
      updateStudentVoicePrefs(a, { studentId: c.studentId, prefs: { ttsAutoplay: false, sttCloudFallback: false, sttLanguage: 'vi' } }),
  },
  listMisconceptionCatalog: { kind: 'self-account', call: (a) => listMisconceptionCatalog(a) },
};
