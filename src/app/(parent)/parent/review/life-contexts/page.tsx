import { requireParentActor } from '@/server/auth/session';
import { listLifeContextsForReview } from '@/server/dal/life-contexts-dal';
import { fillVariables, renderTemplateText } from '@/server/domain/life-context/fill-variables';
import { lifeContextTemplateSchema } from '@/server/domain/life-context/life-context-schema';
import { approveLifeContextAction } from './actions';

export const dynamic = 'force-dynamic';

const THEME_VI: Record<string, string> = {
  market: 'chợ, mua bán',
  cooking: 'nấu ăn',
  sport: 'thể thao',
  nature: 'thiên nhiên',
  animals: 'con vật',
  travel: 'đi lại',
  home: 'việc nhà',
  game: 'trò chơi',
  school: 'trường lớp',
  other: 'khác',
};

// Duyệt thư viện tình huống (SPEC §5b.4, §11.1 › Duyệt): xem trước bài mẫu đã điền số (code điền, không
// gọi model). Chưa duyệt thì Cú không dùng.
export default async function LifeContextReviewPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const actor = await requireParentActor();
  const [contexts, query] = await Promise.all([listLifeContextsForReview(actor), searchParams]);
  return (
    <>
      <h1>Duyệt tình huống đời thật</h1>
      <p className="muted">
        Tiêu chuẩn: câu hỏi là câu người thật sẽ hỏi; số liệu hợp lý; không tên nhãn hàng; việc liên quan bếp, dao, điện, ra
        ngoài phải có người lớn; không cho con làm một mình ngoài nhà.
      </p>
      {query.ok && <p className="notice ok">{query.ok}</p>}
      {query.err && <p className="notice err">{query.err}</p>}
      {contexts.length === 0 && <p>Thư viện chưa có tình huống nào (data/life-contexts, chạy pnpm db:seed).</p>}
      {contexts.map((c) => {
        const template = lifeContextTemplateSchema.safeParse(c.template);
        let preview = '(không điền được số — kiểm lại khoảng biến)';
        if (template.success) {
          try {
            const f = fillVariables(template.data);
            preview = `${renderTemplateText(template.data.setup, f.display)} ${renderTemplateText(template.data.real_question, f.display)}`;
          } catch {
            /* giữ thông báo mặc định */
          }
        }
        const safety = c.safety as { adult_required?: boolean; notes?: string };
        return (
          <section key={c.id} className="card">
            <h3>
              {c.id} · {c.skill_id} · {THEME_VI[c.theme] ?? c.theme}
            </h3>
            <p>
              <strong>Bài mẫu:</strong> {preview}
            </p>
            <p className="muted small">
              Lớp {c.min_grade}–{c.max_grade} · {safety.adult_required ? 'cần người lớn' : 'không cần người lớn'}
              {safety.notes ? ` · ${safety.notes}` : ''}
            </p>
            {c.approved_at ? (
              <p className="notice ok">Đã duyệt {c.approved_at.toLocaleDateString('vi-VN')}</p>
            ) : (
              <form action={approveLifeContextAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="contentHash" value={c.content_hash} />
                <button type="submit">Duyệt tình huống này</button>
              </form>
            )}
          </section>
        );
      })}
    </>
  );
}
