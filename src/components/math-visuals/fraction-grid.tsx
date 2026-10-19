// Hình chia phần: lưới 10 hoặc 100 ô, tô `filled` ô — minh hoạ phần mười, phần trăm (0,45 = 45 ô / 100).
export function FractionGrid({ parts, filled }: { parts: 10 | 100; filled: number }) {
  const cols = 10;
  const rows = parts / cols;
  const cell = 22;
  return (
    <svg viewBox={`0 0 ${cols * cell + 2} ${rows * cell + 2}`} className="math-visual" role="img" aria-label={`${filled} trên ${parts} phần được tô`}>
      {Array.from({ length: parts }, (_, i) => (
        <rect
          key={i}
          x={1 + (i % cols) * cell}
          y={1 + Math.floor(i / cols) * cell}
          width={cell}
          height={cell}
          className={i < filled ? 'mv-cell mv-cell-on' : 'mv-cell'}
        />
      ))}
    </svg>
  );
}
