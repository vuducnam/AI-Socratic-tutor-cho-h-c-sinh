'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireParentActor } from '@/server/auth/session';
import { approveKeyFactsLesson } from '@/server/domain/curriculum/approve-key-facts';

export async function approveKeyFactsLessonAction(form: FormData) {
  const actor = await requireParentActor();
  const data = z.object({ lessonId: z.string().min(1).max(60), contentHash: z.string().min(1).max(64) }).parse(Object.fromEntries(form));
  let error: string | null = null;
  try {
    await approveKeyFactsLesson(actor, data);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Không duyệt được';
  }
  redirect(`/parent/review/key-facts?${error ? `err=${encodeURIComponent(error)}` : `ok=${encodeURIComponent(`Đã duyệt ${data.lessonId}`)}`}#${data.lessonId}`);
}
