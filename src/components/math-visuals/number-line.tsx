// Trục số từ `from` tới `to` với vạch chia `step`, đánh dấu các điểm (số thập phân, dấu phẩy).
export function NumberLine({ from, to, step, marks }: { from: number; to: number; step: number; marks: { value: number; label?: string }[] }) {
  const width = 300;
  const x = (v: number) => 10 + ((v - from) / (to - from)) * width;
  const ticks = Math.round((to - from) / step);
  const fmt = (v: number) => String(Number(v.toFixed(4))).replace('.', ',');
  return (
    <svg viewBox="0 0 320 70" className="math-visual" role="img" aria-label="Trục số">
      <line x1="10" y1="30" x2={10 + width} y2="30" className="mv-axis" />
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = from + i * step;
        return (
          <g key={i}>
            <line x1={x(v)} y1="24" x2={x(v)} y2="36" className="mv-axis" />
            {(i === 0 || i === ticks || ticks <= 10) && (
              <text x={x(v)} y="54" textAnchor="middle" className="mv-tick">
                {fmt(v)}
              </text>
            )}
          </g>
        );
      })}
      {marks.map((m) => (
        <g key={m.value}>
          <circle cx={x(m.value)} cy="30" r="5" className="mv-mark" />
          <text x={x(m.value)} y="16" textAnchor="middle" className="mv-value">
            {m.label ?? fmt(m.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}
