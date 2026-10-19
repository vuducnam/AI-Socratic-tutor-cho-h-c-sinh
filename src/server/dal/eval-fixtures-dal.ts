import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Actor } from './actor';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertSystem } from './role-guards';

// Hồ sơ GIẢ cho eval và script nghiệm thu (phase 10, 14). Chỉ chạy được trên database cu_eval/cu_test,
// không bao giờ trên DB thật của con.

export class NotEvalDatabaseError extends Error {
  constructor() {
    super('Chỉ tạo hồ sơ giả trên database cu_eval hoặc cu_test (DATABASE_URL)');
    this.name = 'NotEvalDatabaseError';
  }
}

export function assertEvalDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/\/(cu_eval|cu_test)(\?|$)/.test(url)) throw new NotEvalDatabaseError();
}

export interface EvalPersonaInput {
  displayName: string;
  gender: 'male' | 'female';
  grade: number;
  interests: string[];
  progress: { subject: string; frontierLessonId: string | null; previewLessonIds?: string[] }[];
}

export async function createEvalPersona(actor: Actor, input: EvalPersonaInput): Promise<{ studentId: string }> {
  assertSystem(actor);
  assertEvalDatabase();
  const owner = await prisma.user.upsert({
    where: { email: 'eval-owner@eval.local' },
    create: { role: 'admin', name: 'Eval', email: 'eval-owner@eval.local', password_hash: 'disabled' },
    update: {},
    select: { id: true },
  });
  const student = await prisma.student.create({
    data: {
      username: `eval-${randomUUID().slice(0, 12)}`,
      display_name: input.displayName,
      gender: input.gender,
      pin_hash: 'disabled',
      created_by: owner.id,
      grade: input.grade,
      preset: 'grade5',
      is_family: true,
      interests_declared: input.interests,
      address: { tutor_self: 'Cú', student: input.displayName },
      companion: { name: 'Cú', avatar: 'owl_blue' },
      learning_prefs: { representation: 'visual', escalation_threshold: 2, session_minutes: 15, daily_limit_minutes: 30 },
    },
    select: { id: true },
  });
  for (const p of input.progress) {
    if (!p.frontierLessonId && !p.previewLessonIds?.length) continue;
    await prisma.schoolProgress.create({
      data: {
        student_id: student.id,
        subject: p.subject,
        frontier_lesson_id: p.frontierLessonId,
        preview_lesson_ids: p.previewLessonIds ?? [],
        set_by: owner.id,
      },
    });
  }
  return { studentId: student.id };
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  assertEvalDatabase: { kind: 'no-actor', reason: 'chỉ kiểm tên database, không đọc dữ liệu' },
  createEvalPersona: {
    kind: 'system-only',
    call: (a) => createEvalPersona(a, { displayName: 'x', gender: 'male', grade: 5, interests: [], progress: [] }),
  },
};
