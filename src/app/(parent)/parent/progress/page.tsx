import { ProgressEditor } from '@/components/progress/progress-editor';
import { requireParentActor } from '@/server/auth/session';
import { listLinkedStudents } from '@/server/dal/students-dal';
import { loadProgressView } from '@/server/domain/curriculum/progress-view';
import { parentPreviewAction, parentSetFrontierAction, parentStaleReminderAction } from './actions';

export const dynamic = 'force-dynamic';

const SUBJECT = 'math';

export default async function ParentProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; ok?: string; err?: string }>;
}) {
  const actor = await requireParentActor();
  const query = await searchParams;
  const children = await listLinkedStudents(actor);
  const selected = children.find((c) => c.id === query.studentId) ?? children[0];
  if (!selected) return <p>Chưa có hồ sơ học sinh nào được liên kết với tài khoản này.</p>;
  const view = await loadProgressView(actor, { studentId: selected.id, subject: SUBJECT });
  return (
    <>
      {children.length > 1 && (
        <nav className="tabs">
          {children.map((c) => (
            <a key={c.id} href={`/parent/progress?studentId=${c.id}`} aria-current={c.id === selected.id}>
              {c.display_name}
            </a>
          ))}
        </nav>
      )}
      <h1>{selected.display_name}</h1>
      {query.ok && <p className="notice ok">{query.ok}</p>}
      {query.err && <p className="notice err">{query.err}</p>}
      <ProgressEditor
        studentId={selected.id}
        subject={SUBJECT}
        lessons={view.lessons}
        frontierLessonId={view.frontierLessonId}
        previewLessonIds={view.previewLessonIds}
        staleReminderEnabled={view.staleReminderEnabled}
        scope={view.scope}
        setFrontierAction={parentSetFrontierAction}
        previewAction={parentPreviewAction}
        staleReminderAction={parentStaleReminderAction}
      />
    </>
  );
}
