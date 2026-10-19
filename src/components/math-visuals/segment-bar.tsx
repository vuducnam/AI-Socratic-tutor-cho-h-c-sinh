// Sơ đồ đoạn thẳng có tham số (SPEC §10: hình toán vẽ bằng SVG từ code, không dùng image gen).
// So sánh độ dài các đại lượng; nhãn số dùng dấu phẩy thập phân.
export function SegmentBar({ items, unit = '' }: { items: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(...items.map((i) => i.value), 0.0001);
  const row = 34;
  return (
    <svg viewBox={`0 0 320 ${items.length * row + 8}`} className="math-visual" role="img" aria-label="Sơ đồ đoạn thẳng">
      {items.map((it, i) => {
        const w = Math.max(4, (it.value / max) * 200);
        return (
          <g key={it.label} transform={`translate(0 ${i * row + 4})`}>
            <text x="0" y="18" className="mv-label">
              {it.label}
            </text>
            <rect x="70" y="6" width={w} height="16" rx="3" className="mv-bar" />
            <text x={76 + w} y="19" className="mv-value">
              {String(it.value).replace('.', ',')}
              {unit ? ` ${unit}` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
