'use client';

import { OwlAvatar } from './owl-avatar';

// Màn hình phụ của /learn: giới thiệu lần đầu (lời lẽ lớp 5, SPEC §11.5), "Cú đang nghỉ" (PC tắt / API
// không phản hồi — không hiện lỗi kỹ thuật), thông báo chặn (chưa có tiến độ, hết giờ), chấm cuối phiên.

export function IntroScreen({ name, onStart }: { name: string; onStart: () => void }) {
  return (
    <section className="center-screen">
      <OwlAvatar size={96} />
      <h1>Chào {name}! Mình là Mít.</h1>
      <ul className="intro-list">
        <li>Mít là bạn học cùng của bạn. Mít không nói đáp án, Mít hỏi để bạn tự nghĩ ra.</li>
        <li>Bạn gửi đề bài bằng cách nói, gõ hoặc chụp ảnh. Bí quá thì bấm “Gợi ý”.</li>
        <li>Bố mẹ xem được mọi cuộc trò chuyện của bạn với Mít. Mít không giữ bí mật với bố mẹ.</li>
        <li>Nếu có chuyện buồn hay điều làm bạn sợ, bạn hãy kể ngay với bố mẹ hoặc cô giáo nhé.</li>
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
      <h1>Mít đang nghỉ</h1>
      <p>Bạn hỏi bố mẹ nhé. Lát nữa bạn thử lại.</p>
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

/** Xong một bài: con chấm vui/chán (không đóng phiên), rồi làm bài khác trong cùng phiên hoặc xong hôm nay. */
export function EndOfProblem({
  onRate,
  onNewProblem,
  onFinish,
  rated,
  finishing,
}: {
  onRate: (rating: 'fun' | 'ok' | 'boring') => void;
  onNewProblem: () => void;
  onFinish: () => void;
  rated: boolean;
  finishing: boolean;
}) {
  return (
    <section className="end-bar">
      {!rated ? (
        <>
          <p>Hôm nay học với Mít thế nào?</p>
          <div className="rating">
            {RATINGS.map((r) => (
              <button key={r.value} type="button" className="ghost" onClick={() => onRate(r.value)}>
                <span aria-hidden="true">{r.face}</span> {r.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p>Cảm ơn bạn!</p>
      )}
      <div className="rating">
        <button type="button" className="ghost" onClick={onNewProblem} disabled={finishing}>
          Làm bài khác
        </button>
        <button type="button" onClick={onFinish} disabled={finishing}>
          Xong hôm nay
        </button>
      </div>
    </section>
  );
}

/** Con bấm "Xong hôm nay": phiên đã đóng (báo cáo phiên gửi bố mẹ). "Học tiếp" mở phiên mới. */
export function SessionEndedScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="center-screen">
      <OwlAvatar size={96} />
      <h1>Hôm nay bạn học xong rồi!</h1>
      <p>Mít chờ bạn lần sau nhé.</p>
      <button type="button" className="ghost" onClick={onContinue}>
        Học tiếp
      </button>
    </section>
  );
}
