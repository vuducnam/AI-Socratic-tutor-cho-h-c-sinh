import { notFound } from 'next/navigation';
import { requireParentActor } from '@/server/auth/session';
import { loadSelectedChild } from '../../_lib/parent-page-helpers';

export const dynamic = 'force-dynamic';

// Xoá dữ liệu — bước 1/2: giải thích hậu quả. Bước 2 yêu cầu gõ đúng tên gọi của con.
export default async function PurgeStepOnePage({ searchParams }: { searchParams: Promise<{ studentId?: string }> }) {
  const actor = await requireParentActor();
  const { studentId } = await searchParams;
  const { selected } = await loadSelectedChild(actor, studentId);
  if (!selected || selected.id !== studentId) notFound();

  return (
    <section className="card danger-zone">
      <h1>Xoá toàn bộ dữ liệu của {selected.display_name} — bước 1/2</h1>
      <p>Khi xoá:</p>
      <ul>
        <li>Hồ sơ, mọi phiên học, transcript, lượt gọi model, guard verdict, tiến độ, cờ, báo cáo, dữ liệu độc lập bị xoá vĩnh viễn.</li>
        <li>Ảnh đề, ảnh nhiệm vụ, bản scan đồng ý bị xoá khỏi máy chủ.</li>
        <li>Con bị đăng xuất khỏi mọi thiết bị và không đăng nhập được nữa; muốn dùng lại phải nhờ admin tạo hồ sơ mới.</li>
        <li>Không khôi phục được. Chỉ còn lại một dòng nhật ký ghi rằng bạn đã xoá (không chứa nội dung).</li>
      </ul>
      <p>
        <strong>Nên tải file export trước khi xoá</strong> nếu muốn giữ một bản:{' '}
        <a href={`/api/export?studentId=${selected.id}`}>tải file export</a>.
      </p>
      <p className="inline-form">
        <a href={`/parent/data?studentId=${selected.id}`}>Huỷ, quay lại</a>
        <a className="button-link danger" href={`/parent/data/purge/confirm?studentId=${selected.id}`}>
          Tôi hiểu, tiếp tục sang bước 2
        </a>
      </p>
    </section>
  );
}
