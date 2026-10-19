import { requireParentActor } from '@/server/auth/session';
import { listFlags } from '@/server/dal/flags-dal';
import { ChildTabs, NoChild, Notices } from '../_components/child-tabs';
import { formatDateTime, loadSelectedChild, SEVERITY_LABELS } from '../_lib/parent-page-helpers';
import { acknowledgeFlagAction } from './actions';

export const dynamic = 'force-dynamic';

// Cờ cho phụ huynh (SPEC §11.1): mọi cờ kèm chi tiết và lượt làm bằng chứng; đánh dấu đã xem.
export default async function ParentFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; ok?: string; err?: string }>;
}) {
  const actor = await requireParentActor();
  const query = await searchParams;
  const { children, selected } = await loadSelectedChild(actor, query.studentId);
  if (!selected) return <NoChild />;
  const flags = await listFlags(actor, { studentId: selected.id });

  return (
    <>
      <ChildTabs basePath="/parent/flags" items={children} selectedId={selected.id} />
      <h1>Cờ của {selected.display_name}</h1>
      <Notices ok={query.ok} err={query.err} />
      {flags.length === 0 && <p className="muted">Chưa có cờ nào.</p>}
      <ul className="plain-list">
        {flags.map((f) => (
          <li key={f.id} className={`card severity-${f.severity}`}>
            <p>
              <strong>{SEVERITY_LABELS[f.severity] ?? f.severity}</strong> · {f.type} · {formatDateTime(f.created_at)}
            </p>
            {f.session_id && (
              <p>
                Phiên:{' '}
                <a href={`/parent/sessions/${f.session_id}?studentId=${selected.id}`}>xem transcript</a>
              </p>
            )}
            {f.evidence_turn_ids.length > 0 && f.session_id && (
              <p className="small">
                Lượt bằng chứng:{' '}
                {f.evidence_turn_ids.map((t) => (
                  <a key={t} href={`/parent/sessions/${f.session_id}?studentId=${selected.id}#turn-${t}`} className="evidence-link">
                    {t.slice(0, 8)}
                  </a>
                ))}
              </p>
            )}
            {f.detail !== null && <pre>{JSON.stringify(f.detail, null, 2)}</pre>}
            {f.acknowledged_at ? (
              <p className="muted small">Đã xem lúc {formatDateTime(f.acknowledged_at)}</p>
            ) : (
              <form action={acknowledgeFlagAction} className="inline-form">
                <input type="hidden" name="studentId" value={selected.id} />
                <input type="hidden" name="flagId" value={f.id} />
                <button type="submit">Đánh dấu đã xem</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
