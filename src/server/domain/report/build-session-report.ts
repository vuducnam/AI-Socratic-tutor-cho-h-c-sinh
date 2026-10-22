import 'server-only';
import type { Actor } from '@/server/dal/actor';
import { appendSessionReport, loadSessionForReport, validEvidenceIds } from '@/server/dal/reports-dal';
import { callLlm, LlmOutputInvalidError, LlmUnavailableError } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import { filterUnevidencedClaims, narrativeSchema } from './filter-unevidenced-claims';
import { computeSessionMetrics } from './metrics';

// Báo cáo phiên (SPEC §11.2 › Phiên, quy tắc cứng 4): sự kiện và số liệu do code tính; LLM
// (report_narrative/v1) chỉ viết diễn giải; nhận định thiếu bằng chứng hợp lệ bị loại trước khi lưu.
// LLM lỗi → vẫn lưu báo cáo chỉ có số liệu (không bao giờ mất phần do code tính).

export const REPORT_PROMPT = 'report_narrative/v1';

export async function buildSessionReport(actor: Actor, input: { studentId: string; sessionId: string }): Promise<string> {
  const data = await loadSessionForReport(actor, input);
  const metrics = computeSessionMetrics({
    turns: data.turns,
    verdicts: data.verdicts,
    feedback: data.feedback,
    problemIds: data.problems.map((p) => p.id),
    openedVia: data.session.opened_via,
  });
  const blockedTurns = [...new Set(data.verdicts.filter((v) => v.verdict === 'block').map((v) => v.turn_id).filter(Boolean))];
  const facts = {
    problems: data.problems.map((p) => ({
      id: p.id,
      origin: p.origin,
      text: p.confirmed_text,
      skills: p.skill_ids.map((id) => {
        const s = data.skills.find((x) => x.skill_id === id);
        const src = (s?.source ?? {}) as { book?: string; lesson?: string; pages?: string };
        return { skill_id: id, name: s?.name ?? id, source: `${src.book ?? '?'}, ${src.lesson ?? '?'}${src.pages ? `, tr. ${src.pages}` : ''}` };
      }),
    })),
    turn_count: data.turns.length,
    student_turn_count: data.turns.filter((t) => t.role === 'student').length,
    max_scaffold_level: Math.max(0, ...data.turns.map((t) => t.scaffold_level ?? 0)),
    reached_done: data.turns.some((t) => t.state_after === 'DONE'),
    guard_blocked_turn_ids: blockedTurns,
    flags: data.flags.map((f) => ({ id: f.id, type: f.type, severity: f.severity })),
    transfer_answers: data.turns.filter((t) => t.turn_kind === 'transfer_answer').map((t) => ({ turn_id: t.id, text: t.content })),
    feedback: data.feedback?.rating ?? null,
    end_reason: data.session.end_reason,
  };

  let narrative: unknown = null;
  let llmCallId: string | null = null;
  try {
    const prompt = await loadPrompt(REPORT_PROMPT);
    const system = renderPrompt(prompt.content, {
      grade: 5,
      metrics: JSON.stringify(metrics),
      facts: JSON.stringify(facts),
      transcript: data.turns.map((t) => `[${t.id}] ${t.role === 'student' ? 'HS' : 'CU'}: ${t.content}`).join('\n'),
    });
    const r = await callLlm({
      purpose: 'report_narrative',
      studentId: input.studentId,
      sessionId: input.sessionId,
      promptVersion: REPORT_PROMPT,
      system: [{ text: system }],
      messages: [{ role: 'user', content: `Phiên ${input.sessionId}. Viết diễn giải.` }],
      responseSchema: narrativeSchema,
    });
    llmCallId = r.llmCallId;
    const ids = await validEvidenceIds(actor, {
      studentId: input.studentId,
      turnIds: [...r.parsed!.summary, ...r.parsed!.student_reasoning_quotes, ...r.parsed!.concerns].flatMap((c) => c.evidence_turn_ids),
      sessionIds: [...r.parsed!.summary, ...r.parsed!.student_reasoning_quotes, ...r.parsed!.concerns].flatMap((c) => c.evidence_session_ids),
    });
    const filtered = filterUnevidencedClaims(r.parsed!, {
      ...ids,
      turnText: new Map(data.turns.filter((t) => t.role === 'student').map((t) => [t.id, t.content])),
    });
    // Câu trích nguyên văn chỉ được lấy từ lượt của CON (turnText chỉ chứa lượt học sinh) — với nhận định
    // thường, lượt Cú cũng là bằng chứng hợp lệ.
    narrative = { ...filtered.narrative, dropped: filtered.dropped };
  } catch (err) {
    if (!(err instanceof LlmUnavailableError || err instanceof LlmOutputInvalidError)) throw err;
    narrative = { error: 'Chưa viết được phần diễn giải; số liệu bên trên do code tính.' };
  }

  return appendSessionReport(actor, {
    studentId: input.studentId,
    sessionId: input.sessionId,
    periodStart: data.session.started_at,
    periodEnd: data.session.ended_at ?? data.session.last_activity_at,
    metrics: { ...metrics, facts },
    narrative,
    llmCallId,
  });
}
