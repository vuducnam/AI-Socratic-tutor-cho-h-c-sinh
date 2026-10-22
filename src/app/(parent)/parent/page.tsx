import { requireParentActor } from '@/server/auth/session';
import { getParentOverview } from '@/server/dal/parent-views-dal';
import { listSystemAlerts } from '@/server/dal/system-alerts-dal';
import { Notices } from './_components/child-tabs';
import { formatDateTime, SEVERITY_LABELS } from './_lib/parent-page-helpers';
import { acknowledgeSystemAlertAction, unlockStudentPinAction } from './overview-actions';

export const dynamic = 'force-dynamic';

// Tổng quan (SPEC §11.1): các con, phiên gần nhất, cờ chưa xem, cảnh báo hệ thống.
export default async function ParentOverviewPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const actor = await requireParentActor();
  const [children, alerts, query] = await Promise.all([
    getParentOverview(actor),
    listSystemAlerts(actor, { onlyOpen: true }),
    searchParams,
  ]);

  return (
    <>
      <h1>Tổng quan</h1>
      <Notices ok={query.ok} err={query.err} />

      {alerts.length > 0 && (
        <section className="card">
          <h2>Cảnh báo hệ thống</h2>
          <ul className="plain-list">
            {alerts.map((a) => (
              <li key={a.id} className={`severity-${a.severity}`}>
                <strong>{SEVERITY_LABELS[a.severity] ?? a.severity}</strong> · {a.type} · {formatDateTime(a.created_at)}
                <details>
                  <summary>Chi tiết</summary>
                  <pre>{JSON.stringify(a.detail, null, 2)}</pre>
                </details>
                <form action={acknowledgeSystemAlertAction} className="inline-form">
                  <input type="hidden" name="alertId" value={a.id} />
                  <button type="submit">Đã xem</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {children.length === 0 && <p>Chưa có hồ sơ học sinh nào được liên kết với tài khoản này.</p>}

      {children.map((child) => (
        <section key={child.id} className="card">
          <h2>
            {child.display_name} <span className="muted small">· lớp {child.grade}{child.status !== 'active' ? ' · đang khoá' : ''}</span>
          </h2>
          <p>
            Cờ chưa xem:{' '}
            <a href={`/parent/flags?studentId=${child.id}`}>
              <strong>{child.unacknowledgedFlags}</strong>
            </a>
          </p>
          {child.pinLock && (
            <div className="notice err">
              <p>
                {child.pinLock.kind === 'hard'
                  ? `Mã PIN đang bị khoá sau ${child.pinLock.failedCount} lần nhập sai liên tiếp. Con chỉ đăng nhập lại được khi bố mẹ mở khoá.`
                  : `Mã PIN đang tạm khoá tới ${formatDateTime(child.pinLock.until)} sau ${child.pinLock.failedCount} lần nhập sai.`}{' '}
                Xem nhật ký đăng nhập ở mục Dữ liệu nếu không phải con nhập sai.
              </p>
              <form action={unlockStudentPinAction} className="inline-form">
                <input type="hidden" name="studentId" value={child.id} />
                <button type="submit">Mở khoá PIN</button>
              </form>
            </div>
          )}
          <h3>Phiên gần nhất</h3>
          {child.recentSessions.length === 0 ? (
            <p className="muted">Chưa có phiên học nào.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bắt đầu</th>
                  <th>Môn</th>
                  <th>Số lượt</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {child.recentSessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a href={`/parent/sessions/${s.id}?studentId=${child.id}`}>{formatDateTime(s.started_at)}</a>
                    </td>
                    <td>{s.subject}</td>
                    <td>{s._count.turns}</td>
                    <td>{s.ended_at ? 'Đã kết thúc' : 'Đang mở'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p>
            <a href={`/parent/sessions?studentId=${child.id}`}>Xem mọi phiên</a>
          </p>
        </section>
      ))}
    </>
  );
}
