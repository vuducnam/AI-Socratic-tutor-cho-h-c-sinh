'use client';

import { useRef, useState, type FormEvent } from 'react';
import { MathKeyboard } from '@/components/math-keyboard/math-keyboard';
import { useVoiceRecorder } from './use-voice-recorder';
import { MicButton, VoiceBar } from './voice-controls';
import {
  browserStorage,
  mergeTranscript,
  readStoredLanguage,
  submitMetaFor,
  TRANSCRIPT_LIMITS,
  writeStoredLanguage,
  type SttLanguage,
  type SttPiece,
  type SubmitMeta,
} from './voice-input-logic';

// Ô nhập của con: micro (cách nhập chính khi có `voice`) + text + bàn phím toán + nút "Gợi ý".
// Nói xong, chữ Mít nghe được hiện trong ô để con đọc/sửa rồi tự bấm Gửi (không tự gửi).
// Khoá trong lúc chờ Mít trả lời.

export interface ComposerVoice {
  sessionId: string;
  defaultLanguage: SttLanguage;
  onRecordingStart: () => void;
}

export function Composer({
  disabled,
  placeholder,
  submitLabel,
  multiline = false,
  showHint = false,
  voice,
  onSubmit,
  onHint,
}: {
  disabled: boolean;
  placeholder: string;
  submitLabel: string;
  multiline?: boolean;
  showHint?: boolean;
  voice?: ComposerVoice;
  onSubmit: (text: string, meta: SubmitMeta) => void;
  onHint?: () => void;
}) {
  // Ô nhiều dòng là ô nhập đề (/api/learn/problem), ô một dòng là tin chat (/api/chat).
  const maxChars = multiline ? TRANSCRIPT_LIMITS.problem : TRANSCRIPT_LIMITS.chat;
  const [text, setText] = useState('');
  // Các đoạn STT (kèm biên nhận) của tin đang soạn; rỗng = tin gõ tay. Server ghép thành raw_stt cho bố mẹ xem.
  const [sttPieces, setSttPieces] = useState<SttPiece[]>([]);
  const [keyboard, setKeyboard] = useState(false);
  const [language, setLanguageState] = useState<SttLanguage>(() => readStoredLanguage(browserStorage(), voice?.defaultLanguage ?? 'vi'));
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);

  const recorder = useVoiceRecorder({
    enabled: !!voice,
    sessionId: voice?.sessionId ?? null,
    language,
    levelTarget: formRef,
    onStart: () => voice?.onRecordingStart(),
    onTranscript: (heard, receipt) => {
      setText((t) => mergeTranscript(t, heard, maxChars));
      setSttPieces((pieces) => [...pieces, { text: heard, receipt }]);
      // Đưa con tới nút Gửi; không focus ô nhập để bàn phím ảo không che màn hình trên tablet.
      requestAnimationFrame(() => sendRef.current?.focus());
    },
  });
  const voiceOn = recorder.supported;
  const voiceBusy = recorder.status === 'requesting' || recorder.status === 'recording' || recorder.status === 'transcribing';

  const setLanguage = (next: SttLanguage) => {
    setLanguageState(next);
    writeStoredLanguage(browserStorage(), next);
  };

  const updateText = (next: string) => {
    setText(next);
    if (!next.trim()) setSttPieces([]); // con xoá hết để gõ lại: tin mới là tin gõ tay
  };

  const insert = (s: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    updateText(text.slice(0, start) + s + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + s.length, start + s.length);
    });
  };
  const backspace = () => updateText(text.slice(0, -1));

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || disabled || voiceBusy) return;
    onSubmit(value, submitMetaFor(sttPieces));
    setText('');
    setSttPieces([]);
    recorder.clearMessage();
  }

  const fieldProps = {
    ref: inputRef,
    value: text,
    onChange: (e: { target: { value: string } }) => updateText(e.target.value),
    placeholder,
    disabled,
    'aria-label': placeholder,
    maxLength: maxChars,
  };

  return (
    <form ref={formRef} className="composer" onSubmit={submit}>
      {voiceOn && <VoiceBar recorder={recorder} language={language} onLanguage={setLanguage} />}
      <div className={`composer-row${voiceOn ? ' composer-row-voice' : ''}`}>
        {voiceOn && <MicButton recorder={recorder} disabled={disabled} />}
        {multiline ? <textarea {...fieldProps} rows={3} /> : <input {...fieldProps} enterKeyHint="send" />}
      </div>
      {keyboard && <MathKeyboard onInsert={insert} onBackspace={backspace} />}
      <div className="composer-actions">
        <button type="button" className="ghost" aria-pressed={keyboard} onClick={() => setKeyboard((k) => !k)}>
          {keyboard ? 'Ẩn bàn phím toán' : 'Bàn phím toán'}
        </button>
        {showHint && onHint && (
          <button type="button" className="ghost hint" disabled={disabled || voiceBusy} onClick={onHint}>
            Gợi ý
          </button>
        )}
        <button ref={sendRef} type="submit" disabled={disabled || voiceBusy || !text.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
