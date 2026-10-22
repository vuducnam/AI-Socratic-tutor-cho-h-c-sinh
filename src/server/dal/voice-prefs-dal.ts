import 'server-only';
import { z } from 'zod';
import type { Actor } from './actor';
import { assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Cài đặt giọng nói của con (SPEC §10), nằm trong students.learning_prefs (không đổi schema):
// - tts_autoplay: Mít tự đọc câu trả lời (mặc định tắt);
// - stt_cloud_fallback: cho gửi giọng lên OpenRouter khi STT ở PC lỗi (mặc định tắt, quy tắc cứng 10);
// - stt_language: ngôn ngữ nói mặc định trên màn hình chat (mặc định tiếng Việt).

export const STT_LANGUAGES = ['vi', 'en'] as const;
export type SttLanguage = (typeof STT_LANGUAGES)[number];

export const studentVoicePrefsSchema = z.object({
  ttsAutoplay: z.boolean(),
  sttCloudFallback: z.boolean(),
  sttLanguage: z.enum(STT_LANGUAGES),
});
export type StudentVoicePrefs = z.infer<typeof studentVoicePrefsSchema>;

export const DEFAULT_VOICE_PREFS: StudentVoicePrefs = Object.freeze({
  ttsAutoplay: false,
  sttCloudFallback: false,
  sttLanguage: 'vi',
});

/**
 * Đọc cài đặt giọng nói từ learning_prefs thô. Giá trị thiếu hoặc sai kiểu → mặc định an toàn
 * (đặc biệt stt_cloud_fallback chỉ bật khi đúng `true`).
 */
export function readVoicePrefs(learningPrefs: unknown): StudentVoicePrefs {
  const prefs = learningPrefs && typeof learningPrefs === 'object' && !Array.isArray(learningPrefs) ? (learningPrefs as Record<string, unknown>) : {};
  const language = prefs.stt_language;
  return {
    ttsAutoplay: prefs.tts_autoplay === true,
    sttCloudFallback: prefs.stt_cloud_fallback === true,
    sttLanguage: (STT_LANGUAGES as readonly unknown[]).includes(language) ? (language as SttLanguage) : DEFAULT_VOICE_PREFS.sttLanguage,
  };
}

/** Học sinh (của chính mình), phụ huynh liên kết hoặc admin; phụ huynh/admin đọc thì ghi access_log. */
export async function getStudentVoicePrefs(actor: Actor, studentId: string): Promise<StudentVoicePrefs> {
  await assertStudentAccess(actor, studentId, { action: 'read', resource: 'students:learning_prefs', log: actor.type !== 'student' });
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { learning_prefs: true } });
  return readVoicePrefs(student.learning_prefs);
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  readVoicePrefs: { kind: 'no-actor', reason: 'hàm thuần đọc JSON learning_prefs đã lấy qua DAL có kiểm quyền' },
  getStudentVoicePrefs: { kind: 'student-scoped', call: (a, c) => getStudentVoicePrefs(a, c.studentId) },
};
