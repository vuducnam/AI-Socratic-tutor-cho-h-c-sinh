import 'server-only';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';

// Câu dự phòng khi Tutor bị chặn 2 lần (SPEC §6 bước 6): câu hỏi gợi ý của bước hiện tại trong plan.
// Câu dự phòng cũng phải qua kiểm tra cứng; vẫn fail → câu chung đã duyệt sẵn, không chứa số liệu.

export const GENERIC_FALLBACK = 'Con nói lại cho Cú nghe con đang làm tới bước nào nhé?';
export const PAUSE_MESSAGE =
  'Cú nghe con nói rồi. Chuyện này con kể ngay với bố mẹ hoặc cô giáo nhé, người lớn sẽ giúp con. Mình tạm dừng bài ở đây nhé?';
export const DONE_MESSAGE = 'Hôm nay con làm tốt lắm vì con đã tự nghĩ ra cách. Hẹn con lần sau nhé!';

export function planFallbackQuestion(plan: SolutionPlan | null, currentStepId: string | null): string | null {
  if (!plan) return null;
  const step = plan.steps.find((s) => s.step_id === currentStepId) ?? plan.steps[0];
  return step?.hint_question ?? null;
}

/** Bước hiện tại = bước đầu tiên chưa hoàn thành. */
export function currentStep(plan: SolutionPlan | null, completed: string[]): string | null {
  return plan?.steps.find((s) => !completed.includes(s.step_id))?.step_id ?? plan?.steps.at(-1)?.step_id ?? null;
}
