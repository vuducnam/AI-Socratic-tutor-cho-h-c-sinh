import 'server-only';
import { z } from 'zod';

// Output JSON của tutor/v7 (SPEC §8.1) và guard/v6 (SPEC §8.2).

export const tutorOutputSchema = z.object({
  message: z.string().min(1).max(600),
  /** Bản ngắn dự phòng cùng ý (≤ 20 từ), dùng ngay khi bản chính vượt giới hạn — không phải gọi lại model. */
  short_message: z.string().max(400),
  question_type: z.enum(['clarify', 'assumption', 'evidence', 'perspective', 'implication', 'meta']),
  step_addressed: z.string().max(20),
  student_state_guess: z.enum(['progressing', 'stuck', 'guessing', 'frustrated', 'done']),
});
export type TutorOutput = z.infer<typeof tutorOutputSchema>;

export const GUARD_REASONS = ['LEAK', 'LENGTH', 'LEVEL', 'SCOPE', 'TONE', 'IMPOSE', 'SECRET', 'SOURCE', 'SAFETY', 'CONTEXT'] as const;
export type GuardReason = (typeof GUARD_REASONS)[number];

export const guardOutputSchema = z.object({
  verdict: z.enum(['pass', 'block']),
  reasons: z.array(z.enum(GUARD_REASONS)).max(10),
  /** Giải thích ngắn để Tutor sửa ở lần sinh lại (không gửi cho con). */
  explanation: z.string().max(400),
});
export type GuardOutput = z.infer<typeof guardOutputSchema>;
