// Thanh chọn con (chỉ hiện khi có từ hai con được liên kết) và dòng thông báo sau Server Action.

export function ChildTabs({
  basePath,
  items,
  selectedId,
}: {
  basePath: string;
  items: { id: string; display_name: string }[];
  selectedId: string;
}) {
  if (items.length < 2) return null;
  return (
    <nav className="tabs">
      {items.map((c) => (
        <a key={c.id} href={`${basePath}?studentId=${c.id}`} aria-current={c.id === selectedId}>
          {c.display_name}
        </a>
      ))}
    </nav>
  );
}

export function Notices({ ok, err }: { ok?: string; err?: string }) {
  return (
    <>
      {ok && <p className="notice ok">{ok}</p>}
      {err && <p className="notice err">{err}</p>}
    </>
  );
}

export function NoChild() {
  return <p>Chưa có hồ sơ học sinh nào được liên kết với tài khoản này.</p>;
}
