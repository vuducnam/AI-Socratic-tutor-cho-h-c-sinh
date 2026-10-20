import { requireParentActor } from '@/server/auth/session';
import {
  listIndependentResults,
  listSkillCatalog,
  listTopicArms,
  todayInVietnam,
} from '@/server/dal/independent-results-dal';
import { getStudentProfile } from '@/server/dal/students-dal';
import { ChildTabs, NoChild, Notices } from '../_components/child-tabs';
import { formatDecimal, loadSelectedChild } from '../_lib/parent-page-helpers';
import { createIndependentResultAction, setTopicArmAction } from './actions';

export const dynamic = 'force-dynamic';

const TYPE_LABELS: Record<string, string> = {
  class_test: 'Bài kiểm tra trên lớp',
  paper_quiz: 'Bài làm trên giấy ở nhà',
  teacher_note: 'Nhận xét của cô',
};

// Dữ liệu độc lập (SPEC §11.1, §15.15): nhập kết quả bên ngoài Cú và gán chủ đề vào nhóm with_cu / without_cu.
export default async function ParentIndependentPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; ok?: string; err?: string }>;
}) {
  const actor = await requireParentActor();
  const query = await searchParams;
  const { children, selected } = await loadSelectedChild(actor, query.studentId);
  if (!selected) return <NoChild />;
  const [results, arms, profile] = await Promise.all([
    listIndependentResults(actor, { studentId: selected.id }),
    listTopicArms(actor, { studentId: selected.id }),
    getStudentProfile(actor, { studentId: selected.id }),
  ]);
  const skills = await listSkillCatalog({ grade: profile.grade });
  const skillName = (id: string) => skills.find((s) => s.skill_id === id)?.name ?? id;
  const armOf = (id: string) => arms.find((a) => a.skill_id === id)?.arm ?? '';
  const today = todayInVietnam();

  return (
    <>
      <ChildTabs basePath="/parent/independent" items={children} selectedId={selected.id} />
      <h1>Dữ liệu độc lập của {selected.display_name}</h1>
      <Notices ok={query.ok} err={query.err} />

      <section className="card">
        <h2>Nhập kết quả mới</h2>
        <form action={createIndependentResultAction} className="stack-form">
          <input type="hidden" name="studentId" value={selected.id} />
          <label>
            Loại
            <select name="type" required defaultValue="class_test">
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kỹ năng liên quan (giữ Ctrl để chọn nhiều)
            <select name="skillIds" multiple size={Math.min(8, Math.max(3, skills.length))}>
              {skills.map((s) => (
                <option key={s.skill_id} value={s.skill_id}>
                  {s.name} ({s.skill_id})
                </option>
              ))}
            </select>
          </label>
          <div className="inline-form">
            <label>
              Điểm
              <input name="score" inputMode="decimal" placeholder="vd. 8,5" />
            </label>
            <label>
              Điểm tối đa
              <input name="maxScore" inputMode="decimal" placeholder="vd. 10" />
            </label>
          </div>
          <label>
            Ghi chú / nhận xét của cô
            <textarea name="note" rows={3} maxLength={2000} />
          </label>
          <label>
            Ngày làm bài
            <input type="date" name="takenOn" required max={today} defaultValue={today} />
          </label>
          <button type="submit">Lưu kết quả</button>
        </form>
      </section>

      <section className="card">
        <h2>Kết quả đã nhập ({results.length})</h2>
        {results.length === 0 ? (
          <p className="muted">Chưa có kết quả nào.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Loại</th>
                <th>Điểm</th>
                <th>Kỹ năng</th>
                <th>Ghi chú</th>
                <th>Người nhập</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td>{r.taken_on.split('-').reverse().join('/')}</td>
                  <td>{TYPE_LABELS[r.type] ?? r.type}</td>
                  <td>{r.score === null ? '—' : `${formatDecimal(r.score)} / ${formatDecimal(r.max_score)}`}</td>
                  <td>{r.skill_ids.length ? r.skill_ids.map(skillName).join('; ') : '—'}</td>
                  <td className="pre-wrap">{r.note ?? '—'}</td>
                  <td>{r.enterer.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Nhóm chủ đề: học cùng Mít / không dùng Mít</h2>
        <p className="muted small">
          Gán mỗi kỹ năng vào một nhóm để sau này so sánh kết quả bên ngoài giữa chủ đề học cùng Mít và chủ đề không dùng Mít.
        </p>
        {skills.length === 0 ? (
          <p className="muted">Chưa có kỹ năng nào của lớp {profile.grade} trong danh mục.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Kỹ năng</th>
                <th>Nhóm</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr key={s.skill_id}>
                  <td>
                    {s.name}
                    <div className="muted small">{s.skill_id}</div>
                  </td>
                  <td>
                    <form action={setTopicArmAction} className="inline-form">
                      <input type="hidden" name="studentId" value={selected.id} />
                      <input type="hidden" name="skillId" value={s.skill_id} />
                      <select name="arm" defaultValue={armOf(s.skill_id)} required>
                        <option value="" disabled>
                          Chưa gán
                        </option>
                        <option value="with_cu">Học cùng Mít</option>
                        <option value="without_cu">Không dùng Mít</option>
                      </select>
                      <button type="submit">Lưu</button>
                    </form>
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
