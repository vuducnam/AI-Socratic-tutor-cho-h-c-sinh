'use client';

import { Composer, type ComposerVoice } from './composer';
import type { SubmitMeta } from './voice-input-logic';
import { PhotoProblem } from './photo-problem';

// Hai khung nộp đề của /learn: gõ hoặc chụp ảnh đề, rồi con xác nhận chữ Mít đọc được từ ảnh.

type Crop = { x: number; y: number; width: number; height: number };

export function ProblemEntryPanel({
  voice,
  onText,
  onPhoto,
}: {
  voice?: ComposerVoice;
  onText: (text: string, meta: SubmitMeta) => void;
  onPhoto: (file: File, crop: Crop | null) => void;
}) {
  return (
    <section className="problem-entry">
      <h2>Bạn gửi đề bài cho Mít nhé</h2>
      <Composer disabled={false} multiline voice={voice} placeholder="Đọc hoặc gõ đề bài ở đây" submitLabel="Gửi đề" onSubmit={(t, meta) => onText(t, meta)} />
      <p className="or">hoặc</p>
      <PhotoProblem disabled={false} onSend={onPhoto} />
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
      <h2>Mít đọc được đề thế này. Bạn xem đúng chưa?</h2>
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
