import type { Metadata } from 'next';
import { ChatApp } from '@/components/chat/chat-app';
import { requireStudentActor } from '@/server/auth/session';
import { getStudentContext } from '@/server/dal/sessions-dal';
import { getStudentVoicePrefs } from '@/server/dal/voice-prefs-dal';

export const metadata: Metadata = { title: 'Học với Mít', manifest: '/manifest.webmanifest' };
export const dynamic = 'force-dynamic';

export default async function LearnPage() {
  const actor = await requireStudentActor();
  const [student, prefs] = await Promise.all([getStudentContext(actor, { studentId: actor.id }), getStudentVoicePrefs(actor, actor.id)]);
  // Chỉ gửi xuống trình duyệt phần client cần dùng; dự phòng STT cloud do server tự áp dụng.
  return <ChatApp studentName={student.display_name} voicePrefs={{ ttsAutoplay: prefs.ttsAutoplay, sttLanguage: prefs.sttLanguage }} />;
}
