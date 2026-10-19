'use client';

import { useEffect, useRef } from 'react';
import { FractionGrid } from '@/components/math-visuals/fraction-grid';
import { NumberLine } from '@/components/math-visuals/number-line';
import { SegmentBar } from '@/components/math-visuals/segment-bar';
import type { ChatLine, Visual } from './chat-types';
import { OwlAvatar } from './owl-avatar';

function VisualFor({ visual }: { visual: Visual }) {
  if (visual.kind === 'segment_bar' || visual.kind === 'box') {
    return <SegmentBar items={visual.items} unit={visual.items[0]?.unit ?? ''} />;
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

export function MessageList({ lines, busyText }: { lines: ChatLine[]; busyText: string | null }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines.length, busyText]);

  return (
    <ol className="messages" aria-live="polite">
      {lines.map((line) => (
        <li key={line.turnId} className={`msg msg-${line.from} ${line.kind === 'hook' ? 'msg-hook' : ''}`}>
          {line.from === 'cu' && <OwlAvatar size={36} />}
          <div className="bubble">
            <p>{line.text}</p>
            {line.visual && <VisualFor visual={line.visual} />}
          </div>
        </li>
      ))}
      {busyText && (
        <li className="msg msg-cu msg-busy">
          <OwlAvatar size={36} mood="thinking" />
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
