'use client';

import { OwlAvatar } from './owl-avatar';

// Màn hình phụ của /learn: giới thiệu lần đầu (lời lẽ lớp 5, SPEC §11.5), "Cú đang nghỉ" (PC tắt / API
// không phản hồi — không hiện lỗi kỹ thuật), thông báo chặn (chưa có tiến độ, hết giờ), chấm cuối phiên.

export function IntroScreen({ name, onStart }: { name: string; onStart: () => void }) {
  return (
    <section className="center-screen">
      <OwlAvatar size={96} />
      <h1>Chào {name}! Mình là Cú.</h1>
      <ul className="intro-list">
        <li>Cú là bạn học cùng con. Cú không nói đáp án, Cú hỏi để con tự nghĩ ra.</li>
        <li>Con gửi đề bài bằng cách gõ hoặc chụp ảnh. Bí quá thì bấm “Gợi ý”.</li>
        <li>Bố mẹ xem được mọi cuộc trò chuyện của con với Cú. Cú không giữ bí mật với bố mẹ.</li>
        <li>Nếu có chuyện buồn hay điều làm con sợ, con hãy kể ngay với bố mẹ hoặc cô giáo nhé.</li>
      </ul>
      <button type="button" onClick={onStart}>
        Bắt đầu học
      </button>
    </section>
  );
}

export function RestingScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="center-screen">
      <OwlAvatar size={96} mood="resting" />
      <h1>Cú đang nghỉ</h1>
      <p>Con hỏi bố nhé. Lát nữa con thử lại.</p>
      <button type="button" className="ghost" onClick={onRetry}>
        Thử lại
      </button>
    </section>
  );
}

export function BlockedScreen({ message }: { message: string }) {
  return (
    <section className="center-screen">
      <OwlAvatar size={96} />
      <p className="lead">{message}</p>
    </section>
  );
}

const RATINGS = [
  { value: 'fun', label: 'Vui', face: '😄' },
  { value: 'ok', label: 'Bình thường', face: '🙂' },
  { value: 'boring', label: 'Chán', face: '😐' },
] as const;

export function EndOfProblem({
  onRate,
  onNewProblem,
  rated,
}: {
  onRate: (rating: 'fun' | 'ok' | 'boring') => void;
  onNewProblem: () => void;
  rated: boolean;
}) {
  return (
    <section className="end-bar">
      {!rated ? (
        <>
          <p>Hôm nay học với Cú thế nào?</p>
          <div className="rating">
            {RATINGS.map((r) => (
              <button key={r.value} type="button" className="ghost" onClick={() => onRate(r.value)}>
                <span aria-hidden="true">{r.face}</span> {r.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p>Cảm ơn con! Cú chờ con lần sau nhé.</p>
      )}
      <button type="button" className="ghost" onClick={onNewProblem}>
        Làm bài khác
      </button>
    </section>
  );
}
