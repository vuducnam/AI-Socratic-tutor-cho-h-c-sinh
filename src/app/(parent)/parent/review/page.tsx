import { requireParentActor } from '@/server/auth/session';
import { listMisconceptionCatalog } from '@/server/dal/parent-settings-dal';
import { formatDateTime } from '../_lib/parent-page-helpers';

export const dynamic = 'force-dynamic';

// Duyệt (SPEC §11.1): danh mục misconception chỉ đọc — trạng thái duyệt lấy từ YAML seed (data/skills),
// sửa ở file YAML rồi seed lại. Thư viện tình huống đời thật duyệt ở trang riêng.
export default async function ParentReviewPage() {
  const actor = await requireParentActor();
  const misconceptions = await listMisconceptionCatalog(actor);
  const pending = misconceptions.filter((m) => !m.approved_at).length;

  return (
    <>
      <h1>Duyệt</h1>
      <section className="card">
        <h2>Thư viện tình huống đời thật</h2>
        <p>
          <a href="/parent/review/life-contexts">Mở trang duyệt tình huống đời thật</a>
        </p>
      </section>
      <section className="card">
        <h2>Misconception ({misconceptions.length}, chưa duyệt {pending})</h2>
        <p className="muted small">
          Chỉ xem. Trạng thái duyệt lấy từ file YAML trong <code>data/skills</code>; muốn đổi thì sửa file rồi chạy lại seed.
        </p>
        {misconceptions.length === 0 ? (
          <p className="muted">Chưa có misconception nào trong danh mục.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Mã</th>
                <th>Mô tả</th>
                <th>Câu hỏi thăm dò</th>
                <th>Duyệt</th>
              </tr>
            </thead>
            <tbody>
              {misconceptions.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.skill.name}
                    <div className="muted small">{m.skill_id}</div>
                  </td>
                  <td className="small">
                    <code>{m.id}</code>
                  </td>
                  <td>{m.description}</td>
                  <td>{m.probe ?? '—'}</td>
                  <td>
                    {m.approved_at ? (
                      <>
                        Đã duyệt {formatDateTime(m.approved_at)}
                        {m.approver && <div className="muted small">{m.approver.name}</div>}
                      </>
                    ) : (
                      <span className="text-danger">Chưa duyệt (nháp)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
