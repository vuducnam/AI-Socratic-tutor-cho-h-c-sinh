'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireParentActor } from '@/server/auth/session';
import { approveLifeContext } from '@/server/domain/life-context/approve-life-context';

export async function approveLifeContextAction(form: FormData) {
  const actor = await requireParentActor();
  const data = z.object({ id: z.string().min(1).max(100), contentHash: z.string().min(1).max(64) }).parse(Object.fromEntries(form));
  let error: string | null = null;
  try {
    await approveLifeContext(actor, data);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Không duyệt được';
  }
  redirect(`/parent/review/life-contexts?${error ? `err=${encodeURIComponent(error)}` : `ok=${encodeURIComponent(`Đã duyệt ${data.id}`)}`}`);
}
