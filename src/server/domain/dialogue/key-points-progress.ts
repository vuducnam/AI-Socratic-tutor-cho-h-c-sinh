import 'server-only';
import { matchedPhrase, type MatchableFact } from '@/lib/key-point-matcher';
import type { SituationalVisual } from '@/server/domain/life-context/generate-situational-problem';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';

// Tiến độ của con với câu hỏi môn kiến thức (SPEC §5d, quy tắc cứng 7): code tính con đã tự nêu ý chính nào qua
// mọi lượt của bài, bước nào xong, đã đủ ý chưa. Cụm từ có sẵn trong câu hỏi không tính (con nhắc lại đề không phải
// là biết ý đó), và cũng không tính là Mít làm lộ.

/** Bỏ các cụm chấp nhận đã có trong câu hỏi; ý không còn cụm nào thì không chấm được bằng code. */
export function factsBeyondQuestion<T extends MatchableFact>(facts: T[], problemText: string): T[] {
  return facts.map((f) => ({ ...f, accept: f.accept.filter((a) => matchedPhrase(problemText, { fact_id: f.fact_id, accept: [a] }) === null) }));
}

export interface KeyPointsProgress {
  /** Ý chính (bắt buộc hoặc ngữ cảnh) con đã tự nêu, theo thứ tự trong plan. */
  statedFactIds: string[];
  /** Bước có mọi fact_ids đã được con nêu. */
  completedSteps: string[];
  /** Đủ min_required ý bắt buộc (câu opinion: luôn false, kết bài theo argue). */
  answered: boolean;
}

export function keyPointsProgress(input: { plan: SolutionPlan; facts: MatchableFact[]; problemText: string; studentTexts: string[] }): KeyPointsProgress {
  const k = input.plan.knowledge;
  if (!k) return { statedFactIds: [], completedSteps: [], answered: false };
  const said = input.studentTexts.join('\n');
  const byId = new Map(factsBeyondQuestion(input.facts, input.problemText).map((f) => [f.fact_id, f]));
  const order = [...k.required_fact_ids, ...k.context_fact_ids.filter((id) => !k.required_fact_ids.includes(id))];
  const stated = order.filter((id) => {
    const fact = byId.get(id);
    return !!fact && fact.accept.length > 0 && matchedPhrase(said, fact) !== null;
  });
  const statedSet = new Set(stated);
  const completedSteps = input.plan.steps.filter((s) => (s.fact_ids ?? []).length > 0 && (s.fact_ids ?? []).every((id) => statedSet.has(id))).map((s) => s.step_id);
  const requiredStated = k.required_fact_ids.filter((id) => statedSet.has(id)).length;
  return { statedFactIds: stated, completedSteps, answered: k.question_type !== 'opinion' && requiredStated >= k.min_required };
}

/**
 * Ý chính Mít không được nói ra trước con: ý bắt buộc. Câu ý kiến không có ý bắt buộc: dẫn chứng là ý ngữ cảnh,
 * con tự kể hoặc tự đọc trong sách, nên Mít cũng không kể trước. Ý ngữ cảnh của câu sự kiện, giải thích là bối cảnh
 * Mít được dùng để hỏi gợi.
 */
export function guardedFactIds(knowledge: NonNullable<SolutionPlan['knowledge']>): string[] {
  return knowledge.question_type === 'opinion' ? [...knowledge.required_fact_ids, ...knowledge.context_fact_ids] : knowledge.required_fact_ids;
}

/**
 * Cụm từ Mít KHÔNG được nói (kiểm tra cứng LEAK) cho mỗi ý cần giữ (guardedFactIds) con chưa tự nêu: cụm chấp nhận
 * và chữ cần giữ (withhold: đồ vật trong hình, chữ gợi gần đáp án), trừ cụm có sẵn trong câu hỏi và chữ cần giữ con
 * đã tự nói. Ý con đã nêu thì Mít nhắc lại được.
 */
export function withheldPhrases(input: {
  plan: SolutionPlan;
  facts: (MatchableFact & { withhold?: string[] })[];
  problemText: string;
  statedFactIds: string[];
  studentTexts?: string[];
}): { fact_id: string; phrases: string[] }[] {
  const k = input.plan.knowledge;
  if (!k) return [];
  const stated = new Set(input.statedFactIds);
  const guarded = guardedFactIds(k);
  const said = (input.studentTexts ?? []).join('\n');
  const withholdOf = new Map(input.facts.map((f) => [f.fact_id, f.withhold ?? []]));
  const notSaid = (fact_id: string, term: string) => matchedPhrase(said, { fact_id, accept: [term] }) === null;
  return factsBeyondQuestion(input.facts, input.problemText)
    .filter((f) => guarded.includes(f.fact_id) && !stated.has(f.fact_id))
    .map((f) => {
      const withhold = factsBeyondQuestion([{ fact_id: f.fact_id, accept: withholdOf.get(f.fact_id) ?? [] }], input.problemText)[0]!.accept;
      return { fact_id: f.fact_id, phrases: [...f.accept, ...withhold.filter((t) => notSaid(f.fact_id, t))] };
    })
    .filter((f) => f.phrases.length > 0);
}

const YEAR = /(?<!\d)(1\d{3}|20\d{2})(?!\d)/g;
const LABEL_WORDS = 6;

/**
 * Trục thời gian (SPEC §5d): mốc năm trong các ý chính con ĐÃ tự nêu (không lộ ý chưa nêu). Mỗi năm một mốc, nhãn là
 * vài chữ đầu của ý chính. Ít hơn hai năm khác nhau thì không vẽ.
 */
export function statedTimeline(facts: { fact_id: string; statement: string }[], statedFactIds: string[]): SituationalVisual | null {
  const byYear = new Map<number, string>();
  for (const id of statedFactIds) {
    const fact = facts.find((f) => f.fact_id === id);
    if (!fact) continue;
    for (const m of fact.statement.matchAll(YEAR)) {
      const year = Number(m[1]);
      if (byYear.has(year)) continue;
      const words = fact.statement.split(/\s+/);
      byYear.set(year, words.slice(0, LABEL_WORDS).join(' ') + (words.length > LABEL_WORDS ? '…' : ''));
    }
  }
  if (byYear.size < 2) return null;
  const items = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([value, label]) => ({ label, value, unit: '' }));
  return { kind: 'timeline', items };
}
