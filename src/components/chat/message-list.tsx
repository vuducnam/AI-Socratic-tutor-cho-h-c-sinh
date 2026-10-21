'use client';

import { useEffect, useRef } from 'react';
import { FractionGrid } from '@/components/math-visuals/fraction-grid';
import { NumberLine } from '@/components/math-visuals/number-line';
import { SegmentBar } from '@/components/math-visuals/segment-bar';
import type { ChatLine, Visual } from './chat-types';
import { OwlAvatar } from './owl-avatar';
import { isSpeakableLine } from './tts-playback-logic';
import type { TtsPlayer } from './use-tts-player';
import { SpeakerIcon } from './voice-controls';

function VisualFor({ visual }: { visual: Visual }) {
  if (visual.kind === 'segment_bar' || visual.kind === 'box') {
    return <SegmentBar items={visual.items} />;
  }
  if (visual.kind === 'number_line') {
    const values = visual.items.map((i) => i.value);
    const lo = Math.floor(Math.min(...values));
    const hi = Math.ceil(Math.max(...values)) === lo ? lo + 1 : Math.ceil(Math.max(...values));
    return <NumberLine from={lo} to={hi} step={(hi - lo) / 10} marks={visual.items.map((i) => ({ value: i.value, label: i.label }))} />;
  }
  const first = visual.items[0]?.value ?? 0;
  return <FractionGrid parts={100} filled={Math.round(first * 100) % 101} />;
}

type Speech = Pick<TtsPlayer, 'activeId' | 'loading' | 'unavailable' | 'toggle'>;

// Nút "nghe" nhỏ dưới mỗi tin của Mít; server không có tiếng cho lượt đó → không hiện nút.
function ListenButton({ turnId, speech }: { turnId: string; speech: Speech }) {
  if (speech.unavailable.has(turnId)) return null;
  const active = speech.activeId === turnId;
  const loading = active && speech.loading;
  return (
    <button
      type="button"
      className={`listen-button${active ? ' is-active' : ''}`}
      aria-label={active ? 'Dừng đọc' : 'Nghe Mít đọc tin này'}
      aria-busy={loading}
      onClick={() => speech.toggle(turnId)}
    >
      <SpeakerIcon />
      <span aria-hidden="true">{loading ? 'đang tải' : active ? 'dừng' : 'nghe'}</span>
    </button>
  );
}

/** Chữ cái đầu của tên gọi (không dựa vào giới tính, quy tắc cứng 9); tên trống → "B" (bạn). */
export function nameInitial(name: string): string {
  const first = name.trim().normalize('NFC').charAt(0);
  return first ? first.toLocaleUpperCase('vi') : 'B';
}

// Biểu tượng người nói: cú cho Mít, vòng tròn chữ cái đầu tên cho con.
function StudentAvatar({ name }: { name: string }) {
  return (
    <span className="me-avatar" aria-hidden="true">
      {nameInitial(name)}
    </span>
  );
}

export function MessageList({
  lines,
  busyText,
  speech,
  studentName = '',
}: {
  lines: ChatLine[];
  busyText: string | null;
  speech?: Speech;
  studentName?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines.length, busyText]);

  return (
    <ol className="messages" aria-live="polite">
      {lines.map((line) => (
        <li key={line.turnId} className={`msg msg-${line.from} ${line.kind === 'hook' ? 'msg-hook' : ''}`}>
          {line.from === 'cu' ? <OwlAvatar size={40} /> : <StudentAvatar name={studentName} />}
          <div className="bubble">
            <p>
              <span className="sr-only">{line.from === 'cu' ? 'Mít: ' : 'Bạn: '}</span>
              {line.text}
            </p>
            {line.visual && <VisualFor visual={line.visual} />}
            {speech && isSpeakableLine(line) && <ListenButton turnId={line.turnId} speech={speech} />}
          </div>
        </li>
      ))}
      {busyText && (
        <li className="msg msg-cu msg-busy">
          <OwlAvatar size={40} mood="thinking" />
          <div className="bubble">
            <p>
              {busyText}
              <span className="dots" aria-hidden="true">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </p>
          </div>
        </li>
      )}
      <div ref={endRef} />
    </ol>
  );
}
