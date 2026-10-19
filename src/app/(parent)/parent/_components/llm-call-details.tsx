import type { SessionTranscript } from '@/server/dal/parent-views-dal';
import { formatDateTime } from '../_lib/parent-page-helpers';
import { JsonBlock } from './json-block';

// Một lượt gọi model đầy đủ: prompt gửi đi (request), response thô, provider, model, prompt_version,
// tokens, chi phí, độ trễ, lỗi (SPEC §11.1 › Phiên).

type LlmCallRow = SessionTranscript['llmCalls'][number];
type GuardVerdictRow = SessionTranscript['guardVerdicts'][number];

export function LlmCallDetails({ call }: { call: LlmCallRow }) {
  return (
    <details className="llm-call">
      <summary>
        <strong>{call.purpose}</strong> · {call.provider} · {call.model}
        {call.prompt_version && <> · {call.prompt_version}</>}
        {call.error && <span className="badge-danger"> lỗi</span>}
      </summary>
      <dl className="kv">
        <dt>Mã lượt gọi</dt>
        <dd>
          <code>{call.id}</code>
        </dd>
        <dt>Thời điểm</dt>
        <dd>{formatDateTime(call.created_at)}</dd>
        <dt>Chế độ</dt>
        <dd>{call.mode}</dd>
        <dt>Tokens (vào / ra / cache đọc / cache ghi)</dt>
        <dd>
          {call.input_tokens ?? '—'} / {call.output_tokens ?? '—'} / {call.cache_read_tokens ?? '—'} / {call.cache_write_tokens ?? '—'}
        </dd>
        <dt>Chi phí (USD)</dt>
        <dd>{call.cost_usd ?? '—'}</dd>
        <dt>Độ trễ</dt>
        <dd>{call.latency_ms === null ? '—' : `${call.latency_ms} ms`}</dd>
        {call.error && (
          <>
            <dt>Lỗi</dt>
            <dd className="text-danger">{call.error}</dd>
          </>
        )}
      </dl>
      <JsonBlock label="Prompt gửi đi (request đầy đủ)" value={call.request} />
      <JsonBlock label="Response thô" value={call.response} />
    </details>
  );
}

export function GuardVerdictList({ verdicts }: { verdicts: GuardVerdictRow[] }) {
  if (verdicts.length === 0) return null;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Bộ kiểm</th>
          <th>Lần</th>
          <th>Kết quả</th>
          <th>Lý do</th>
          <th>Lượt gọi Guard / Tutor</th>
        </tr>
      </thead>
      <tbody>
        {verdicts.map((v) => (
          <tr key={v.id}>
            <td>{v.checker === 'code' ? 'Code' : 'LLM'}</td>
            <td>{v.attempt}</td>
            <td className={v.verdict === 'block' ? 'text-danger' : undefined}>{v.verdict === 'block' ? 'Chặn' : 'Cho qua'}</td>
            <td>{v.reasons.length ? v.reasons.join(', ') : '—'}</td>
            <td className="small">
              <code>{v.llm_call_id ?? '—'}</code> / <code>{v.tutor_llm_call_id ?? '—'}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
