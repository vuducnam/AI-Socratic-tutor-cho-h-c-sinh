'use client';

import { Composer, type ComposerVoice } from './composer';
import { OwlAvatar } from './owl-avatar';
import type { SubmitMeta } from './voice-input-logic';
import { PhotoProblem } from './photo-problem';

// Hai khung nộp đề của /learn: gõ hoặc chụp ảnh đề, rồi con xác nhận chữ Mít đọc được từ ảnh.

type Crop = { x: number; y: number; width: number; height: number };

export function ProblemEntryPanel({
  voice,
  onText,
  onPhoto,
  onPractice,
}: {
  voice?: ComposerVoice;
  onText: (text: string, meta: SubmitMeta) => void;
  onPhoto: (file: File, crop: Crop | null) => void;
  /** "Mít ra đề cho bạn": Mít tạo một đề tình huống cho bài con đã học. */
  onPractice: () => void;
}) {
  return (
    <section className="problem-entry">
      <div className="entry-head">
        <OwlAvatar size={56} />
        <h2>Bạn gửi đề bài cho Mít nhé</h2>
      </div>
      <Composer disabled={false} multiline voice={voice} placeholder="Đọc hoặc gõ đề bài ở đây" submitLabel="Gửi đề" onSubmit={(t, meta) => onText(t, meta)} />
      <p className="or">hoặc</p>
      <PhotoProblem disabled={false} onSend={onPhoto} />
      <button type="button" className="practice-button" onClick={onPractice}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.5L12 15l-1.8-4.5L5.5 9l4.7-1.4z" />
          <path d="M19 15l.8 2 2 .8-2 .7-.8 2-.7-2-2-.7 2-.8z" />
        </svg>
        Mít ra đề cho bạn
      </button>
    </section>
  );
}

export function OcrConfirmPanel({
  text,
  onChange,
  onRetake,
  onConfirm,
}: {
  text: string;
  onChange: (text: string) => void;
  onRetake: () => void;
  onConfirm: (text: string) => void;
}) {
  return (
    <section className="problem-entry">
      <div className="entry-head">
        <OwlAvatar size={56} mood="thinking" />
        <h2>Mít đọc được đề thế này. Bạn xem đúng chưa?</h2>
      </div>
      <p className="muted">Chỗ nào sai hoặc có dấu [?], bạn sửa lại cho đúng với đề nhé.</p>
      <textarea className="ocr-text" value={text} rows={4} onChange={(e) => onChange(e.target.value)} aria-label="Đề bài Mít đọc được" />
      <div className="composer-actions">
        <button type="button" className="ghost" onClick={onRetake}>
          Chụp lại
        </button>
        <button type="button" disabled={text.trim().length < 3} onClick={() => onConfirm(text.trim())}>
          Đúng rồi, bắt đầu
        </button>
      </div>
    </section>
  );
}
