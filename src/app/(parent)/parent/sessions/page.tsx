import { requireParentActor } from '@/server/auth/session';
import { listStudentSessions } from '@/server/dal/parent-views-dal';
import { ChildTabs, NoChild } from '../_components/child-tabs';
import { formatDateTime, loadSelectedChild, RATING_LABELS } from '../_lib/parent-page-helpers';

export const dynamic = 'force-dynamic';

// Danh sách mọi phiên của con → mở transcript nguyên văn (SPEC §11.1 › Phiên).
export default async function ParentSessionsPage({ searchParams }: { searchParams: Promise<{ studentId?: string }> }) {
  const actor = await requireParentActor();
  const { children, selected } = await loadSelectedChild(actor, (await searchParams).studentId);
  if (!selected) return <NoChild />;
  const sessions = await listStudentSessions(actor, { studentId: selected.id });

  return (
    <>
      <ChildTabs basePath="/parent/sessions" items={children} selectedId={selected.id} />
      <h1>Phiên học của {selected.display_name}</h1>
      {sessions.length === 0 ? (
        <p className="muted">Chưa có phiên học nào.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Bắt đầu</th>
              <th>Kết thúc</th>
              <th>Môn / chế độ</th>
              <th>Mở bởi</th>
              <th>Lượt</th>
              <th>Đề</th>
              <th>Cờ</th>
              <th>Con đánh giá</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={`/parent/sessions/${s.id}?studentId=${selected.id}`}>{formatDateTime(s.started_at)}</a>
                </td>
                <td>
                  {s.ended_at ? formatDateTime(s.ended_at) : 'Đang mở'}
                  {s.end_reason && <span className="muted small"> ({s.end_reason})</span>}
                </td>
                <td>
                  {s.subject} / {s.mode}
                </td>
                <td>{s.opened_via === 'reminder' ? 'Lời nhắc' : 'Con tự mở'}</td>
                <td>{s._count.turns}</td>
                <td>{s._count.problems}</td>
                <td>{s._count.flags}</td>
                <td>{s.session_feedback[0] ? (RATING_LABELS[s.session_feedback[0].rating] ?? s.session_feedback[0].rating) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
