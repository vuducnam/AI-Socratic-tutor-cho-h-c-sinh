// Hiển thị JSON gốc nguyên văn (prompt gửi đi, response thô, scope_snapshot…), không cắt bớt.

export function JsonBlock({ value, label }: { value: unknown; label?: string }) {
  const text = value === null || value === undefined ? '(trống)' : JSON.stringify(value, null, 2);
  return (
    <div className="json-block">
      {label && <div className="json-label">{label}</div>}
      <pre>{text}</pre>
    </div>
  );
}
