'use client';

import { useRef, useState, type FormEvent } from 'react';
import { MathKeyboard } from '@/components/math-keyboard/math-keyboard';

// Ô nhập của con: text + bàn phím toán + nút "Gợi ý". Khoá trong lúc chờ Cú trả lời.
export function Composer({
  disabled,
  placeholder,
  submitLabel,
  multiline = false,
  showHint = false,
  onSubmit,
  onHint,
}: {
  disabled: boolean;
  placeholder: string;
  submitLabel: string;
  multiline?: boolean;
  showHint?: boolean;
  onSubmit: (text: string) => void;
  onHint?: () => void;
}) {
  const [text, setText] = useState('');
  const [keyboard, setKeyboard] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  const insert = (s: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + s.length, start + s.length);
    });
  };
  const backspace = () => setText((t) => t.slice(0, -1));

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || disabled) return;
    onSubmit(value);
    setText('');
  }

  const fieldProps = {
    ref: inputRef,
    value: text,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    placeholder,
    disabled,
    'aria-label': placeholder,
    maxLength: multiline ? 2000 : 1000,
  };

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-row">
        {multiline ? <textarea {...fieldProps} rows={3} /> : <input {...fieldProps} enterKeyHint="send" />}
      </div>
      {keyboard && <MathKeyboard onInsert={insert} onBackspace={backspace} />}
      <div className="composer-actions">
        <button type="button" className="ghost" aria-pressed={keyboard} onClick={() => setKeyboard((k) => !k)}>
          {keyboard ? 'Ẩn bàn phím toán' : 'Bàn phím toán'}
        </button>
        {showHint && onHint && (
          <button type="button" className="ghost hint" disabled={disabled} onClick={onHint}>
            Gợi ý
          </button>
        )}
        <button type="submit" disabled={disabled || !text.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
