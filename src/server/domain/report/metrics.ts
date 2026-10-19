import 'server-only';

// Metrics tính bằng CODE (SPEC §11.3, quy tắc cứng 4). Giai đoạn 0 tính được: high_scaffold_rate,
// abandon_rate, guessing_rate, fun_share/boring_share, transfer_answer_rate, scope_block_rate. Metric cần
// learner model / dữ liệu độc lập / nhiệm vụ → insufficient_data (Giai đoạn 1).

export type MetricValue = { value: number; numerator: number; denominator: number } | { value: null; status: 'insufficient_data'; reason: string };

export interface ReportTurn {
  id: string;
  role: string;
  turn_kind: string;
  content: string;
  state_after: string | null;
  scaffold_level: number | null;
  problem_id: string | null;
  signals: unknown;
}

export interface ReportVerdict {
  turn_id: string | null;
  verdict: string;
  reasons: string[];
}

const rate = (num: number, den: number): MetricValue =>
  den > 0 ? { value: num / den, numerator: num, denominator: den } : { value: null, status: 'insufficient_data', reason: 'chưa có dữ liệu' };
const later = (reason: string): MetricValue => ({ value: null, status: 'insufficient_data', reason });

export function computeSessionMetrics(input: {
  turns: ReportTurn[];
  verdicts: ReportVerdict[];
  feedback: { rating: string } | null;
  problemIds: string[];
  openedVia: string;
}): Record<string, MetricValue> {
  const tutorTurns = input.turns.filter((t) => t.role !== 'student');
  const studentTurns = input.turns.filter((t) => t.role === 'student');
  const reachedDone = input.turns.some((t) => t.state_after === 'DONE');

  // Bậc hỗ trợ cao nhất mỗi bài (PARALLEL = 4 tính là ≥ 3).
  const maxScaffoldByProblem = new Map<string, number>();
  for (const t of tutorTurns) {
    if (!t.problem_id) continue;
    maxScaffoldByProblem.set(t.problem_id, Math.max(maxScaffoldByProblem.get(t.problem_id) ?? 0, t.scaffold_level ?? 0));
  }
  const problemsTaught = input.problemIds.filter((id) => maxScaffoldByProblem.has(id));
  const highScaffold = problemsTaught.filter((id) => (maxScaffoldByProblem.get(id) ?? 0) >= 3).length;

  // Đoán bừa: tín hiệu code ghi vào lượt trả lời của Cú ngay sau lượt của con.
  const guessingTurns = tutorTurns.filter((t) => (t.signals as { guessing?: boolean } | null)?.guessing === true).length;

  const scopeBlockedTurns = new Set(input.verdicts.filter((v) => v.verdict === 'block' && v.reasons.includes('SCOPE')).map((v) => v.turn_id));
  const transferAnswered = input.turns.some((t) => t.turn_kind === 'transfer_answer' && t.content.trim().length > 0);

  return {
    high_scaffold_rate: rate(highScaffold, problemsTaught.length),
    abandon_rate: rate(reachedDone ? 0 : 1, 1),
    guessing_rate: rate(guessingTurns, studentTurns.length),
    fun_share: input.feedback ? rate(input.feedback.rating === 'fun' ? 1 : 0, 1) : later('con chưa chấm phiên này'),
    boring_share: input.feedback ? rate(input.feedback.rating === 'boring' ? 1 : 0, 1) : later('con chưa chấm phiên này'),
    transfer_answer_rate: reachedDone ? rate(transferAnswered ? 1 : 0, 1) : later('phiên chưa tới DONE'),
    scope_block_rate: rate([...scopeBlockedTurns].filter(Boolean).length, tutorTurns.length),
    voluntary_session: rate(input.openedVia === 'student' ? 1 : 0, 1),
    self_correction_rate: later('cần learner model (Giai đoạn 1)'),
    delayed_recall_accuracy: later('cần lịch ôn (Giai đoạn 1)'),
    in_system_vs_independent_gap: later('cần learner model và dữ liệu độc lập (Giai đoạn 1)'),
    mission_completion_rate: later('nhiệm vụ đời thật thuộc Giai đoạn 1'),
  };
}
