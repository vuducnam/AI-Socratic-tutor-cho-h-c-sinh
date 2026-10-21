import 'server-only';
import type { LlmCallRecorder } from '@/server/dal/llm-calls-dal';
import type { CurriculumScope, ScopeLesson, ScopeSkill } from '@/server/domain/curriculum/scope';
import type { SolutionPlan } from './plan-schema';

// Phần riêng theo môn của Pre-solver (presolve.ts giữ vòng lặp chung: sinh plan → kiểm phạm vi → kiểm đáp án →
// sinh lại). Toán: model giải + sympy (presolve-math-strategy.ts). Môn kiến thức: model lập kế hoạch chỉ từ ý chính
// đã duyệt + code kiểm ý chính (presolve-knowledge-strategy.ts, SPEC §5d).

export interface StrategyCall {
  studentId: string;
  sessionId: string;
  userContent: string;
  mode?: 'live' | 'eval';
  recorder?: LlmCallRecorder;
}

export type GenerateResult =
  | { kind: 'plan'; plan: SolutionPlan; llmCallId: string | null }
  /** Model báo câu hỏi cần kiến thức không có trong ý chính đã duyệt: không sinh lại, không dạy. */
  | { kind: 'not_covered'; reason: string; llmCallId: string | null }
  /** Đầu ra đúng schema nhưng sai về nội dung (ví dụ trỏ tới ý chính không có thật): sinh lại với lời nhắc. */
  | { kind: 'invalid'; reason: string; llmCallId: string | null };

export interface VerifyOutcome {
  verified: boolean;
  /** Ghi vào solution_plans.verifier_output (bố mẹ xem được). */
  output: Record<string, unknown>;
  /** Lời nhắc cho lần sinh lại khi chưa đạt. */
  feedback: string;
}

export interface PresolveStrategy {
  promptVersion: string;
  /** System prompt cho phạm vi hiện tại (đổi khi phạm vi mở thêm cho bài về nhà). */
  system(scope: CurriculumScope, catalog: { lessons: ScopeLesson[]; skills: ScopeSkill[] }): Promise<{ text: string; misconceptionIds: Set<string> }>;
  /** Gọi model (hoặc lấy từ memo của eval) và đổi đầu ra thành plan. Output sai schema → LlmOutputInvalidError. */
  generate(systemText: string, call: StrategyCall): Promise<GenerateResult>;
  /** Kiểm bằng code (+ sympy với Toán) trước khi dạy. */
  verify(plan: SolutionPlan, problemText: string): Promise<VerifyOutcome>;
}
