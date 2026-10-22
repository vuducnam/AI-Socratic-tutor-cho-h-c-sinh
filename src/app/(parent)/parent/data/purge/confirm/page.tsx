import { notFound } from 'next/navigation';
import { requireParentActor } from '@/server/auth/session';
import { Notices } from '../../../_components/child-tabs';
import { loadSelectedChild } from '../../../_lib/parent-page-helpers';
import { purgeStudentAction } from '../../actions';

export const dynamic = 'force-dynamic';

// Xoá dữ liệu — bước 2/2: gõ đúng tên gọi của con và đánh dấu đã hiểu rồi mới xoá.
export default async function PurgeStepTwoPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; err?: string }>;
}) {
  const actor = await requireParentActor();
  const query = await searchParams;
  const { selected } = await loadSelectedChild(actor, query.studentId);
  if (!selected || selected.id !== query.studentId) notFound();

  return (
    <section className="card danger-zone">
      <h1>Xoá toàn bộ dữ liệu của {selected.display_name} — bước 2/2</h1>
      <Notices err={query.err} />
      <form action={purgeStudentAction} className="stack-form">
        <input type="hidden" name="studentId" value={selected.id} />
        <label>
          Gõ đúng tên gọi của con (<strong>{selected.display_name}</strong>) để xác nhận
          <input name="confirmDisplayName" autoComplete="off" required />
        </label>
        <label>
          Lý do (không bắt buộc)
          <input name="reason" maxLength={500} />
        </label>
        <label className="checkbox">
          <input type="checkbox" name="understood" value="yes" required /> Tôi hiểu dữ liệu bị xoá vĩnh viễn và không khôi phục được
        </label>
        <p className="inline-form">
          <a href={`/parent/data?studentId=${selected.id}`}>Huỷ</a>
          <button type="submit" className="danger">
            Xoá vĩnh viễn
          </button>
        </p>
      </form>
    </section>
  );
}
