import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireParentActor } from '@/server/auth/session';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { getSessionTranscript, type SessionTranscript } from '@/server/dal/parent-views-dal';
import { getSessionReport } from '@/server/dal/reports-dal';
import { SessionReportCard } from '../../_components/session-report-card';
import { JsonBlock } from '../../_components/json-block';
import { GuardVerdictList, LlmCallDetails } from '../../_components/llm-call-details';
import { TranscriptTurn } from '../../_components/transcript-turn';
import { formatDateTime, loadSelectedChild, RATING_LABELS, SEVERITY_LABELS } from '../../_lib/parent-page-helpers';
import { subjectName } from '@/server/domain/curriculum/subject-config';

export const dynamic = 'force-dynamic';

// Transcript nguyên văn của một phiên kèm mọi dữ liệu gốc (SPEC §11.1 › Phiên, §15.13).
export default async function ParentSessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ studentId?: string }>;
}) {
  const actor = await requireParentActor();
  const sessionId = z.uuid().safeParse((await params).id);
  if (!sessionId.success) notFound();
  const { selected } = await loadSelectedChild(actor, (await searchParams).studentId);
  if (!selected) notFound();

  let data: SessionTranscript;
  try {
    data = await getSessionTranscript(actor, { studentId: selected.id, sessionId: sessionId.data });
  } catch (err) {
    if (err instanceof AuthorizationError) notFound();
    throw err;
  }
  const { session, turns, llmCalls, guardVerdicts, problems, feedback, flags } = data;
  const report = await getSessionReport(actor, { studentId: selected.id, sessionId: sessionId.data });
  const callsByTurn = (turnId: string) => llmCalls.filter((c) => c.turn_id === turnId);
  const verdictsByTurn = (turnId: string) => guardVerdicts.filter((v) => v.turn_id === turnId);
  const sessionCalls = llmCalls.filter((c) => !c.turn_id || !turns.some((t) => t.id === c.turn_id));
  const sessionVerdicts = guardVerdicts.filter((v) => !v.turn_id || !turns.some((t) => t.id === v.turn_id));
  const transferAnswers = turns.filter((t) => t.turn_kind === 'transfer_answer');

  return (
    <>
      <p>
        <a href={`/parent/sessions?studentId=${selected.id}`}>← Mọi phiên của {selected.display_name}</a>
      </p>
      <h1>Phiên {formatDateTime(session.started_at)}</h1>
      <section className="card">
        <dl className="kv">
          <dt>Môn / chế độ</dt>
          <dd>
            {subjectName(session.subject)} / {session.mode}
          </dd>
          <dt>Mở bởi</dt>
          <dd>{session.opened_via === 'reminder' ? 'Lời nhắc' : 'Con tự mở'}</dd>
          <dt>Kết thúc</dt>
          <dd>
            {session.ended_at ? formatDateTime(session.ended_at) : 'Đang mở'}
            {session.end_reason ? ` (${session.end_reason})` : ''}
          </dd>
          <dt>Con đánh giá</dt>
          <dd>{feedback ? (RATING_LABELS[feedback.rating] ?? feedback.rating) : 'Chưa đánh giá'}</dd>
        </dl>
        <details>
          <summary>Phạm vi kiến thức đã áp cho phiên (scope_snapshot)</summary>
          <JsonBlock value={session.scope_snapshot} />
        </details>
      </section>

      <SessionReportCard report={report} />

      <section className="card">
        <h2>Câu trả lời chuyển giao</h2>
        {transferAnswers.length === 0 ? (
          <p className="muted">Phiên này chưa có câu trả lời chuyển giao.</p>
        ) : (
          <ul>
            {transferAnswers.map((t) => (
              <li key={t.id}>
                <a href={`#turn-${t.id}`}>#{t.seq}</a> {t.content}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ProblemsSection problems={problems} />

      <section className="card">
        <h2>Transcript nguyên văn ({turns.length} lượt)</h2>
        <ol className="transcript">
          {turns.map((t) => (
            <TranscriptTurn key={t.id} turn={t} llmCalls={callsByTurn(t.id)} guardVerdicts={verdictsByTurn(t.id)} />
          ))}
        </ol>
      </section>

      {(sessionCalls.length > 0 || sessionVerdicts.length > 0) && (
        <section className="card">
          <h2>Lượt gọi model và guard verdict không gắn với lượt nào</h2>
          <GuardVerdictList verdicts={sessionVerdicts} />
          {sessionCalls.map((c) => (
            <LlmCallDetails key={c.id} call={c} />
          ))}
        </section>
      )}

      {flags.length > 0 && (
        <section className="card">
          <h2>Cờ trong phiên</h2>
          <ul>
            {flags.map((f) => (
              <li key={f.id}>
                {SEVERITY_LABELS[f.severity] ?? f.severity} · {f.type} · {formatDateTime(f.created_at)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ProblemsSection({ problems }: { problems: SessionTranscript['problems'] }) {
  return (
    <section className="card">
      <h2>Đề bài trong phiên</h2>
      {problems.length === 0 && <p className="muted">Chưa có đề bài.</p>}
      {problems.map((p) => (
        <div key={p.id} className="problem">
          <p>
            <strong>{p.origin === 'homework' ? 'Bài về nhà' : p.origin === 'generated' ? 'Bài Mít tạo' : 'Nhiệm vụ'}</strong>
            {p.confirmed_by_student ? ' · con đã xác nhận đề' : ' · con chưa xác nhận đề'}
          </p>
          <p className="turn-content">{p.confirmed_text ?? p.extracted_text ?? '(chưa có nội dung)'}</p>
          <dl className="kv">
            <dt>Ảnh đề (lưu trữ)</dt>
            <dd>{p.image_uri ? <code>{p.image_uri}</code> : '—'}</dd>
            {/* extracted_text: đề chụp ảnh → chữ đọc từ ảnh; đề nói bằng giọng → chữ STT nguyên bản. */}
            <dt>{p.image_uri ? 'Chữ đọc từ ảnh' : 'Chữ STT gốc (con đọc đề)'}</dt>
            <dd>{p.extracted_text ?? '—'}</dd>
            <dt>Skill</dt>
            <dd>{p.skill_ids.length ? p.skill_ids.join(', ') : '—'}</dd>
            <dt>Tình huống đời thật</dt>
            <dd>{p.life_context_id ?? '—'}</dd>
          </dl>
          {p.context_variables !== null && <JsonBlock label="Biến tình huống" value={p.context_variables} />}
          {p.solution_plans.map((plan) => (
            <details key={plan.id}>
              <summary>
                Lời giải dự tính (Pre-solver) · {plan.verified ? 'sympy đã kiểm' : 'chưa kiểm được'}
              </summary>
              <JsonBlock label="Kế hoạch" value={plan.plan} />
              <JsonBlock label="Đáp án cuối" value={plan.final_answer} />
              <JsonBlock label="Kết quả kiểm" value={plan.verifier_output} />
              {plan.scope_extension !== null && <JsonBlock label="Phạm vi mở thêm cho bài này" value={plan.scope_extension} />}
            </details>
          ))}
        </div>
      ))}
    </section>
  );
}
