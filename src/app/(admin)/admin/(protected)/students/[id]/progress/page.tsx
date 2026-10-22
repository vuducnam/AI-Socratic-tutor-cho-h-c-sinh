import { z } from 'zod';
import { notFound } from 'next/navigation';
import { ProgressEditor } from '@/components/progress/progress-editor';
import { assertAdminRuntime, withAdminReason } from '@/server/auth/session';
import { loadProgressView } from '@/server/domain/curriculum/progress-view';
import { loadSubjects } from '@/server/domain/curriculum/subject-config';
import { adminPreviewAction, adminSetFrontierAction, adminStaleReminderAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AdminStudentProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  // Trang này đọc dữ liệu học sinh: ghi access_log với lý do hỗ trợ đặt tiến độ.
  const actor = withAdminReason(await assertAdminRuntime(), 'admin mở màn hình tiến độ khi tạo/hỗ trợ hồ sơ');
  const views = await Promise.all(loadSubjects().map(async (s) => ({ subject: s, view: await loadProgressView(actor, { studentId: id, subject: s.id }) })));
  const student = views[0]!.view.student;
  return (
    <>
      <p>
        <a href="/admin">← Quản trị</a>
      </p>
      <h1>{student.display_name}</h1>
      {query.ok && <p className="notice ok">{query.ok}</p>}
      {query.err && <p className="notice err">{query.err}</p>}
      {views.map(({ subject, view }) =>
        view.lessons.length === 0 ? (
          <p key={subject.id} className="notice err">
            {subject.name}: chưa có mục lục lớp {student.grade} trong DB (chạy pnpm db:seed).
          </p>
        ) : (
        <ProgressEditor
          key={subject.id}
          studentId={id}
          subject={subject.id}
          subjectName={subject.name}
          lessons={view.lessons}
          frontierLessonId={view.frontierLessonId}
          previewLessonIds={view.previewLessonIds}
          staleReminderEnabled={view.staleReminderEnabled}
          scope={view.scope}
          askReason
          setFrontierAction={adminSetFrontierAction}
          previewAction={adminPreviewAction}
          staleReminderAction={adminStaleReminderAction}
        />
        ),
      )}
    </>
  );
}
