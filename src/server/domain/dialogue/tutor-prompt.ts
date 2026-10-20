import 'server-only';
import type { StudentContext } from '@/server/dal/sessions-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import type { CurriculumScope } from '@/server/domain/curriculum/scope';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import type { SystemBlock } from '@/server/llm/llm-types';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import type { Preset } from './preset';
import type { DialogueState } from './state-machine';

// Dựng system prompt tutor/v6 (SPEC §8.1). Phần ổn định trong một bài (quy tắc, phạm vi, plan, few-shot)
// là khối đầu có prompt caching; phần đổi mỗi lượt (trạng thái, bước) là khối sau.

export const TUTOR_PROMPT = 'tutor/v6';
export const TUTOR_FEWSHOT = 'tutor/fewshot/v2';
export const VOLATILE_MARKER = '<!-- PHẦN THAY ĐỔI MỖI LƯỢT -->';

// Tín hiệu do code phát hiện ở lượt này: không chuyển trạng thái (SPEC §7), chỉ thêm chỉ dẫn cho Tutor.
const GUESSING_GUIDANCE = 'em vừa đổi đáp án nhanh nhiều lần: chậm lại, hỏi em vì sao chọn đáp án đó';
// Đáp án đúng nhưng con đoán: chưa xác nhận, hỏi lý do trước (lượt sau con giải thích được thì mới "Đúng rồi").
const CONSOLIDATE_UNSURE_GUIDANCE =
  'em ra đúng đáp án nhưng có vẻ đoán hoặc chưa chắc: CHƯA nói đúng hay sai, hỏi em vì sao em chọn như vậy (không nhắc lại con số)';
const DOT_DECIMAL_GUIDANCE = 'em viết dấu chấm làm dấu thập phân: nhắc nhẹ em dùng dấu phẩy, không chê';

export interface TurnHints {
  guessing?: boolean;
  dotDecimal?: boolean;
  /** Con tự nói là đoán / chưa chắc (signals.soundsUnsure). */
  unsure?: boolean;
}

// Hướng dẫn ngắn theo trạng thái: code chọn trạng thái, prompt chỉ nói Cú cần làm gì ở trạng thái đó.
const STATE_GUIDANCE: Record<DialogueState, string> = {
  ELICIT: 'mời em nói em hiểu đề thế nào hoặc em định làm gì trước',
  PROBE: 'hỏi để em giải thích cách nghĩ của mình; không gợi ý cách làm',
  SCAFFOLD: 'gợi ý nhỏ theo bậc: bậc 1 hỏi định hướng, bậc 2 thu hẹp vào bước hiện tại, bậc 3 chia bước thành câu hỏi rất nhỏ; vẫn không nói kết quả',
  PARALLEL: 'cùng em làm một bài tương tự dễ hơn rồi quay lại bài gốc',
  DIRECT_TEACH: 'dạy lại ngắn kiến thức tiền đề đã học, mỗi lượt một ý, kết bằng một câu hỏi kiểm tra',
  CONSOLIDATE: 'em đã tự ra đáp án đúng (hệ thống đã kiểm): xác nhận bằng "Đúng rồi," ở đầu câu (dấu phẩy, không tách thành câu riêng; không nhắc lại con số), rồi hỏi em giải thích cách làm hoặc chỗ lúc nãy làm em nhầm',
  TRANSFER: 'hỏi em sẽ gặp lại điều này ở đâu trong đời sống',
  DONE: 'chào em, khen nỗ lực và cách nghĩ',
  PAUSE: 'dừng bài, ân cần khuyên em kể với bố mẹ',
};

/** Chỉ dẫn cho Tutor ở lượt này: theo trạng thái, cộng thêm chỉ dẫn cho tín hiệu code phát hiện. */
export function stateGuidance(state: DialogueState, hints: TurnHints = {}): string {
  const unsureAnswer = state === 'CONSOLIDATE' && (hints.guessing || hints.unsure);
  return [unsureAnswer ? CONSOLIDATE_UNSURE_GUIDANCE : STATE_GUIDANCE[state], !unsureAnswer && hints.guessing && GUESSING_GUIDANCE, hints.dotDecimal && DOT_DECIMAL_GUIDANCE]
    .filter(Boolean)
    .join('; ');
}

export interface TutorPromptInput {
  student: StudentContext;
  preset: Preset;
  scope: CurriculumScope;
  mode: 'solve' | 'argue';
  state: DialogueState;
  scaffoldLevel: number;
  problemText: string;
  plan: SolutionPlan | null;
  misconceptions: { id: string; description: string; probe: string | null }[];
  completedSteps: string[];
  currentStepId: string | null;
  skillSource: string;
  learnerSummary: string;
  hints?: TurnHints;
}

const field = (obj: unknown, key: string, fallback: string) =>
  obj && typeof obj === 'object' && typeof (obj as Record<string, unknown>)[key] === 'string'
    ? ((obj as Record<string, unknown>)[key] as string)
    : fallback;

export async function buildTutorSystem(input: TutorPromptInput): Promise<SystemBlock[]> {
  const [prompt, fewshot] = await Promise.all([loadPrompt(TUTOR_PROMPT), loadPrompt(TUTOR_FEWSHOT)]);
  const text = renderPrompt(prompt.content, {
    'companion.name': field(input.student.companion, 'name', 'Cú'),
    'address.tutor_self': field(input.student.address, 'tutor_self', 'Cú'),
    'address.student': field(input.student.address, 'student', input.student.display_name),
    display_name: input.student.display_name,
    gender_vi: input.student.gender === 'female' ? 'nữ' : 'nam',
    grade: input.student.grade,
    interests_declared: input.student.interests_declared.length ? input.student.interests_declared.join(', ') : 'chưa khai',
    max_sentences: input.preset.max_sentences,
    max_words_per_turn: input.preset.max_words_per_turn,
    max_questions_per_turn: input.preset.max_questions_per_turn,
    skill_source: input.skillSource,
    curriculum_scope: renderCurriculumScope(input.scope),
    problem_text: input.problemText,
    plan: input.plan ? JSON.stringify({ steps: input.plan.steps, final_answer: input.plan.final_answer }) : '(chưa có)',
    misconceptions: input.misconceptions.length
      ? input.misconceptions.map((m) => `${m.id}: ${m.description}${m.probe ? ` (câu dò: ${m.probe})` : ''}`).join('\n')
      : '(chưa có)',
    learner_summary: input.learnerSummary,
    fewshot: fewshot.content,
    state: input.state,
    level: input.scaffoldLevel,
    mode: input.mode,
    intensity: input.preset.socratic_intensity,
    state_guidance: stateGuidance(input.state, input.hints),
    step_id: input.currentStepId ?? '(chưa xác định)',
    completed_steps: input.completedSteps.length ? input.completedSteps.join(', ') : '(chưa có)',
  });
  const [stable, volatile] = text.split(VOLATILE_MARKER);
  return [{ text: stable!.trim(), cache: true }, { text: (volatile ?? '').trim() }];
}

/** Nguồn SGK của skill đang học (Guard SOURCE và quy tắc 6 của Tutor). */
export function describeSkillSource(skills: { name: string; source: unknown }[]): string {
  if (!skills.length) return '(không có)';
  return skills
    .map((s) => {
      const src = s.source as { book?: string; lesson?: string; pages?: string } | null;
      return `${s.name}: SGK ${src?.book ?? '?'}, ${src?.lesson ?? '?'}${src?.pages ? `, trang ${src.pages}` : ''}`;
    })
    .join('; ');
}
