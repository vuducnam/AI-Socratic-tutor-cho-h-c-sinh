import { requireParentActor } from '@/server/auth/session';
import { listStudentAccessLog } from '@/server/dal/parent-data-dal';
import { ChildTabs, NoChild, Notices } from '../_components/child-tabs';
import { formatDateTime, loadSelectedChild } from '../_lib/parent-page-helpers';

export const dynamic = 'force-dynamic';

const ACTOR_LABELS: Record<string, string> = {
  admin: 'Admin',
  parent: 'Phụ huynh',
  student: 'Con',
  system: 'Hệ thống',
  anonymous: 'Chưa đăng nhập',
};

// Dữ liệu (SPEC §11.1): export toàn bộ, xoá toàn bộ (hai bước), nhật ký truy cập. Dòng admin xem
// dữ liệu kèm lý do được tô nổi bật (quy tắc cứng 14).
export default async function ParentDataPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; ok?: string; err?: string }>;
}) {
  const actor = await requireParentActor();
  const query = await searchParams;
  const { children, selected } = await loadSelectedChild(actor, query.studentId);
  if (!selected) return <NoChild />;
  const log = await listStudentAccessLog(actor, { studentId: selected.id });
  const adminWithReason = log.filter((r) => r.actor_type === 'admin' && r.reason).length;

  return (
    <>
      <ChildTabs basePath="/parent/data" items={children} selectedId={selected.id} />
      <h1>Dữ liệu của {selected.display_name}</h1>
      <Notices ok={query.ok} err={query.err} />

      <section className="card">
        <h2>Tải toàn bộ dữ liệu</h2>
        <p>File zip gồm mọi bảng (JSON và CSV) cùng ảnh đề, ảnh nhiệm vụ, bản scan đồng ý.</p>
        <p>
          <a className="button-link" href={`/api/export?studentId=${selected.id}`}>
            Tải file export
          </a>
        </p>
      </section>

      <section className="card danger-zone">
        <h2>Xoá toàn bộ dữ liệu</h2>
        <p>Xoá vĩnh viễn hồ sơ và mọi dữ liệu học tập của con. Cần xác nhận hai bước.</p>
        <p>
          <a href={`/parent/data/purge?studentId=${selected.id}`}>Bắt đầu xoá dữ liệu…</a>
        </p>
      </section>

      <section className="card">
        <h2>Nhật ký truy cập ({log.length} dòng gần nhất)</h2>
        {adminWithReason > 0 && (
          <p className="notice err">Có {adminWithReason} lần admin xem dữ liệu của con kèm lý do (tô vàng bên dưới).</p>
        )}
        <table className="data-table">
          <thead>
            <tr>
              <th>Thời điểm</th>
              <th>Ai</th>
              <th>Hành động</th>
              <th>Tài nguyên</th>
              <th>Lý do</th>
              <th>IP / thiết bị</th>
            </tr>
          </thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.id} className={r.actor_type === 'admin' && r.reason ? 'row-highlight' : undefined}>
                <td>{formatDateTime(r.created_at)}</td>
                <td>
                  {ACTOR_LABELS[r.actor_type] ?? r.actor_type}
                  {r.actor_id && r.actor_id === actor.id && <span className="muted small"> (bạn)</span>}
                </td>
                <td>{r.action}</td>
                <td className="small">{r.resource ?? '—'}</td>
                <td>{r.reason ?? '—'}</td>
                <td className="small">
                  {r.ip ?? '—'}
                  {r.user_agent && <div className="muted">{r.user_agent}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
