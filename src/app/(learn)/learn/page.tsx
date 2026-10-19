import type { Metadata } from 'next';
import { ChatApp } from '@/components/chat/chat-app';
import { requireStudentActor } from '@/server/auth/session';
import { getStudentContext } from '@/server/dal/sessions-dal';

export const metadata: Metadata = { title: 'Học với Cú', manifest: '/manifest.webmanifest' };
export const dynamic = 'force-dynamic';

export default async function LearnPage() {
  const actor = await requireStudentActor();
  const student = await getStudentContext(actor, { studentId: actor.id });
  return <ChatApp studentName={student.display_name} />;
}
