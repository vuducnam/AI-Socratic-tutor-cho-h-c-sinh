'use client';

import { useRef, useState, type PointerEvent } from 'react';

// Chụp ảnh đề → con kéo khung chọn ĐÚNG vùng đề (để tên con, tên trường trên phiếu không bị gửi đi) →
// gửi lên server (server bỏ EXIF/GPS, cắt theo khung). Ảnh không rời máy trước khi con bấm gửi.

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_BYTES = 5 * 1024 * 1024;

export function PhotoProblem({ disabled, onSend }: { disabled: boolean; onSend: (file: File, crop: Rect | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError('Ảnh lớn quá, bạn chụp lại gần hơn nhé.');
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setError('Mít chỉ đọc được ảnh chụp (JPEG, PNG, WebP).');
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setRect(null);
  }

  const point = (e: PointerEvent) => {
    const box = boxRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
    setRect({ ...start.current, width: 0, height: 0 });
  };
  const move = (e: PointerEvent) => {
    if (!start.current) return;
    const p = point(e);
    const s = start.current;
    setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) });
  };
  const up = () => {
    start.current = null;
  };
  const usable = rect && rect.width > 0.05 && rect.height > 0.03 ? rect : null;

  return (
    <div className="photo-problem">
      {!url ? (
        <label className="photo-pick">
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => pick(e.target.files?.[0])} disabled={disabled} />
          <span>Chụp ảnh đề bài</span>
        </label>
      ) : (
        <>
          <p className="muted">Bạn kéo ngón tay để khoanh đúng phần đề bài nhé (không lấy tên bạn, tên trường).</p>
          <div ref={boxRef} className="crop-box" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh cục bộ từ máy con, không qua tối ưu ảnh của Next */}
            <img src={url} alt="Ảnh đề bài bạn vừa chụp" draggable={false} />
            {rect && (
              <div
                className="crop-rect"
                style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
              />
            )}
          </div>
          <div className="composer-actions">
            <button type="button" className="ghost" onClick={() => { setFile(null); setUrl(null); setRect(null); }}>
              Chụp lại
            </button>
            <button type="button" disabled={disabled || !usable} onClick={() => file && onSend(file, usable)}>
              Gửi phần đã khoanh
            </button>
          </div>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
