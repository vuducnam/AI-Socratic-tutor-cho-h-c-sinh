import type { SessionTranscript } from '@/server/dal/parent-views-dal';
import { formatDateTime } from '../_lib/parent-page-helpers';
import { JsonBlock } from './json-block';
import { GuardVerdictList, LlmCallDetails } from './llm-call-details';

// Một lượt trong transcript: nội dung nguyên văn, mở ra xem raw STT, state, scaffold, mọi llm_calls
// (nối qua turn_id) và guard verdict của lượt.

type TurnRow = SessionTranscript['turns'][number];

const ROLE_LABELS: Record<string, string> = { student: 'Con', tutor: 'Cú', system: 'Hệ thống' };
const KIND_LABELS: Record<string, string> = {
  normal: 'Thường',
  hook: 'Câu mở đời thật',
  transfer_question: 'Câu hỏi chuyển giao',
  transfer_answer: 'Câu trả lời chuyển giao',
};

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? '—' : value}</dd>
    </>
  );
}

export function TranscriptTurn({
  turn,
  llmCalls,
  guardVerdicts,
}: {
  turn: TurnRow;
  llmCalls: SessionTranscript['llmCalls'];
  guardVerdicts: SessionTranscript['guardVerdicts'];
}) {
  return (
    <li id={`turn-${turn.id}`} className={`turn turn-${turn.role}`}>
      <div className="turn-head">
        <strong>
          #{turn.seq} {ROLE_LABELS[turn.role] ?? turn.role}
        </strong>
        {turn.turn_kind !== 'normal' && <span className="badge"> {KIND_LABELS[turn.turn_kind] ?? turn.turn_kind}</span>}
        <span className="muted small"> · {formatDateTime(turn.created_at)}</span>
      </div>
      <p className="turn-content">{turn.content}</p>
      <details>
        <summary>
          Chi tiết lượt ({llmCalls.length} lượt gọi model, {guardVerdicts.length} guard verdict)
        </summary>
        <dl className="kv">
          <Field label="Cách nhập" value={turn.input_modality} />
          <Field label="Raw STT" value={turn.raw_stt} />
          <Field label="Nội dung đã chuẩn hoá" value={turn.normalized_content} />
          <Field label="State trước → sau" value={`${turn.state_before ?? '—'} → ${turn.state_after ?? '—'}`} />
          <Field label="Scaffold level" value={turn.scaffold_level} />
          <Field label="Loại lượt" value={turn.turn_kind} />
          <Field label="Loại câu hỏi" value={turn.question_type} />
          <Field label="Bước đang xử lý" value={turn.step_addressed} />
          <Field label="LLM đoán trạng thái con" value={turn.student_state_guess} />
          <Field label="Đề liên quan" value={turn.problem_id} />
        </dl>
        {turn.signals !== null && <JsonBlock label="Tín hiệu do code tính" value={turn.signals} />}
        {guardVerdicts.length > 0 && (
          <>
            <h4>Guard verdict</h4>
            <GuardVerdictList verdicts={guardVerdicts} />
          </>
        )}
        {llmCalls.length > 0 && <h4>Lượt gọi model</h4>}
        {llmCalls.map((c) => (
          <LlmCallDetails key={c.id} call={c} />
        ))}
      </details>
    </li>
  );
}
