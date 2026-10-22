import { requireParentActor } from '@/server/auth/session';
import { listKeyFactsForReview } from '@/server/dal/key-facts-dal';
import { subjectName } from '@/server/domain/curriculum/subject-config';
import { approveKeyFactsLessonAction } from './actions';

export const dynamic = 'force-dynamic';

// Duyệt ý chính (SPEC §5d, quy tắc cứng 6): phụ huynh mở đúng trang SGK chính thống, đối chiếu từng ý của bài rồi
// duyệt cả bài. Bài chưa duyệt thì Mít không dạy. Duyệt qua cổng admin (localhost:3001) để YAML trên máy được cập nhật.
export default async function KeyFactsReviewPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const actor = await requireParentActor();
  const [lessons, query] = await Promise.all([listKeyFactsForReview(actor), searchParams]);
  const pending = lessons.filter((l) => !l.approvedAt).length;
  return (
    <>
      <h1>Duyệt ý chính</h1>
      <p className="muted">
        Mở SGK trên taphuan.nxbgd.vn đúng trang ghi ở từng ý, đối chiếu: nội dung đúng sách, trang và vị trí đúng, cụm từ
        chấp nhận hợp lý. Đúng cả bài thì bấm duyệt. Bài chưa duyệt thì Mít không dạy. Còn {pending}/{lessons.length} bài chưa duyệt.
      </p>
      {query.ok && <p className="notice ok">{query.ok}</p>}
      {query.err && <p className="notice err">{query.err}</p>}
      {lessons.length === 0 && <p>Chưa có ý chính nào (data/key-facts, chạy pnpm db:seed).</p>}
      {lessons.map((l) => (
        <section key={l.lessonId} id={l.lessonId} className="card">
          <h3>
            {subjectName(l.subject)} · Bài {l.lessonId.split('.B')[1]}. {l.title}
          </h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Ý chính</th>
                <th>Trang · chỗ trong sách</th>
                <th>Cụm từ chấp nhận · chữ cần giữ</th>
              </tr>
            </thead>
            <tbody>
              {l.facts.map((f) => (
                <tr key={f.fact_id}>
                  <td>
                    {f.statement}
                    <div className="muted small">
                      <code>{f.fact_id}</code> · {f.kind}
                    </div>
                  </td>
                  <td>
                    tr. {f.pages}
                    <div className="muted small">{f.locator}</div>
                  </td>
                  <td className="small">
                    {f.accept.join(' · ')}
                    {f.withhold.length ? <div className="muted">Mít không nói trước: {f.withhold.join(' · ')}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {l.approvedAt ? (
            <p className="notice ok">
              Đã duyệt {l.approvedAt.toLocaleDateString('vi-VN')}
              {l.approver ? ` · ${l.approver}` : ''}
            </p>
          ) : (
            <form action={approveKeyFactsLessonAction}>
              <input type="hidden" name="lessonId" value={l.lessonId} />
              <input type="hidden" name="contentHash" value={l.contentHash} />
              <button type="submit">Duyệt bài này</button>
            </form>
          )}
        </section>
      ))}
    </>
  );
}
