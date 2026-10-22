// Trục thời gian (SPEC §5d): các mốc năm con đã tự nêu, cách đều theo thứ tự (khoảng cách thật giữa các năm có
// thể rất chênh lệch nên không vẽ theo tỉ lệ). Nhãn so le trên/dưới để không chồng nhau.
export function Timeline({ items }: { items: { label: string; value: number }[] }) {
  const width = 300;
  const x = (i: number) => (items.length === 1 ? 160 : 20 + (i / (items.length - 1)) * (width - 20));
  return (
    <svg viewBox="0 0 320 110" className="math-visual" role="img" aria-label="Trục thời gian các mốc bạn đã tìm ra">
      <line x1="10" y1="55" x2="310" y2="55" className="mv-axis" />
      {items.map((it, i) => {
        const above = i % 2 === 0;
        return (
          <g key={it.value}>
            <circle cx={x(i)} cy="55" r="5" className="mv-mark" />
            <text x={x(i)} y={above ? 40 : 76} textAnchor="middle" className="mv-value">
              {it.value}
            </text>
            <text x={x(i)} y={above ? 24 : 94} textAnchor="middle" className="mv-tick">
              {it.label.length > 28 ? `${it.label.slice(0, 27)}…` : it.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
