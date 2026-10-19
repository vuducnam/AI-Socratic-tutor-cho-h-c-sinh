import 'server-only';
import { createHash } from 'node:crypto';

// computeScope (SPEC §5c.3, quy tắc cứng 15): hàm thuần tính phạm vi kiến thức con đã học trên lớp.
// Lớp học đúng thứ tự SGK: đã học = mọi bài có seq ≤ seq(frontier). Lớp trước: coi như đã học hết.
// Thuật ngữ vừa thuộc bài đã học vừa nằm trong danh sách lớp trên → đã học thắng.
// Kết quả lưu vào sessions.scope_snapshot khi mở phiên và cố định trong phiên.

export interface ScopeTerm {
  term: string;
  patterns: string[];
}

export interface ScopeLesson {
  lesson_id: string;
  subject: string;
  grade: number;
  seq: number;
  book: string;
  title: string;
  skill_ids: string[];
  introduces_terms: ScopeTerm[];
  methods: string[];
}

export interface ScopeSkill {
  skill_id: string;
  subject: string;
  grade_introduced: number;
}

export interface ScopeProgress {
  frontierLessonId: string | null;
  previewLessonIds: string[];
}

export interface LessonRef {
  lessonId: string;
  book: string;
  title: string;
  seq: number;
}

export interface HomeworkExtension {
  /** Bài SGK mà đề thuộc về (bài muộn nhất cần mở) — dùng cho progress_suggestions. */
  lessonId: string;
  lessonIds: string[];
  skillIds: string[];
  terms: ScopeTerm[];
  methods: string[];
}

export interface CurriculumScope {
  subject: string;
  grade: number;
  frontierLesson: LessonRef | null;
  coveredLessonIds: string[];
  previewLessonIds: string[];
  /** Tối đa 5 bài đã học gần nhất (cho {curriculum_scope}). */
  recentLessons: LessonRef[];
  allowedSkillIds: string[];
  allowedTerms: string[];
  allowedMethods: string[];
  forbiddenTerms: ScopeTerm[];
  forbiddenMethods: string[];
  homeworkExtension?: HomeworkExtension;
  scopeHash: string;
}

export interface ComputeScopeInput {
  subject: string;
  grade: number;
  /** Mục lục của môn (có thể gồm cả lớp trước). */
  lessons: ScopeLesson[];
  skills: ScopeSkill[];
  progress: ScopeProgress | null;
  beyondTerms: ScopeTerm[];
}

const ref = (l: ScopeLesson): LessonRef => ({ lessonId: l.lesson_id, book: l.book, title: l.title, seq: l.seq });
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const termKey = (t: string) => t.normalize('NFC').toLowerCase().trim();

function stableHash(value: unknown): string {
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sortKeys)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]))
        : v;
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex').slice(0, 16);
}

/** Bỏ thuật ngữ/pattern bị cấm nếu trùng thuật ngữ hay pattern đã học (đã học thắng). */
function subtractAllowed(forbidden: ScopeTerm[], allowedTerms: ScopeTerm[]): ScopeTerm[] {
  const allowedNames = new Set(allowedTerms.map((t) => termKey(t.term)));
  const allowedPatterns = new Set(allowedTerms.flatMap((t) => t.patterns.map(termKey)));
  const byTerm = new Map<string, ScopeTerm>();
  for (const t of forbidden) {
    if (allowedNames.has(termKey(t.term))) continue;
    const patterns = t.patterns.filter((p) => !allowedPatterns.has(termKey(p)));
    if (!patterns.length) continue;
    const existing = byTerm.get(termKey(t.term));
    byTerm.set(termKey(t.term), { term: t.term, patterns: uniq([...(existing?.patterns ?? []), ...patterns]) });
  }
  return [...byTerm.values()];
}

export function computeScope(input: ComputeScopeInput): CurriculumScope {
  const { subject, grade } = input;
  const current = input.lessons.filter((l) => l.subject === subject && l.grade === grade).sort((a, b) => a.seq - b.seq);
  const earlierGrades = input.lessons.filter((l) => l.subject === subject && l.grade < grade);

  const frontier = input.progress?.frontierLessonId
    ? (current.find((l) => l.lesson_id === input.progress!.frontierLessonId) ?? null)
    : null;
  const covered = frontier ? current.filter((l) => l.seq <= frontier.seq) : [];
  // Bài học trước mà frontier đã vượt qua thì tự rời khỏi danh sách preview.
  const previews = current.filter(
    (l) => (input.progress?.previewLessonIds ?? []).includes(l.lesson_id) && (!frontier || l.seq > frontier.seq),
  );
  const open = [...earlierGrades, ...covered, ...previews];
  const closed = current.filter((l) => !open.includes(l));

  const priorGradeSkills = input.skills.filter((s) => s.subject === subject && s.grade_introduced < grade).map((s) => s.skill_id);
  const allowedTermDefs = open.flatMap((l) => l.introduces_terms);
  const allowedMethods = uniq(open.flatMap((l) => l.methods));

  const scope: Omit<CurriculumScope, 'scopeHash'> = {
    subject,
    grade,
    frontierLesson: frontier ? ref(frontier) : null,
    coveredLessonIds: covered.map((l) => l.lesson_id),
    previewLessonIds: previews.map((l) => l.lesson_id),
    recentLessons: [...covered, ...previews].sort((a, b) => b.seq - a.seq).slice(0, 5).map(ref),
    allowedSkillIds: uniq([...priorGradeSkills, ...open.flatMap((l) => l.skill_ids)]).sort(),
    allowedTerms: uniq(allowedTermDefs.map((t) => t.term)),
    allowedMethods,
    forbiddenTerms: subtractAllowed([...closed.flatMap((l) => l.introduces_terms), ...input.beyondTerms], allowedTermDefs),
    forbiddenMethods: uniq(closed.flatMap((l) => l.methods)).filter((m) => !allowedMethods.includes(m)),
  };
  return { ...scope, scopeHash: stableHash(scope) };
}

export type ProblemScopeDecision =
  | { kind: 'in_scope' }
  | { kind: 'homework_extension'; extension: HomeworkExtension }
  | { kind: 'out_of_scope'; reason: 'beyond_grade' | 'unmapped_skill' | 'generated_not_covered'; skillIds: string[] };

/**
 * Quyết định cho một đề (SPEC §5c.5): skill trong phạm vi → dạy; bài về nhà cùng lớp vượt tiến độ →
 * mở phạm vi riêng bài đó (homeworkExtension, bài = bài có seq nhỏ nhất chứa skill); bài lớp trên, skill
 * không map được, hoặc bài do Cú tạo ngoài phạm vi → không dạy.
 */
export function decideProblemScope(
  scope: CurriculumScope,
  problem: { skillIds: string[]; origin: 'homework' | 'generated' | 'mission' },
  catalog: { lessons: ScopeLesson[]; skills: ScopeSkill[] },
): ProblemScopeDecision {
  const outside = problem.skillIds.filter((s) => !scope.allowedSkillIds.includes(s));
  if (!outside.length) return { kind: 'in_scope' };

  const skillGrade = new Map(catalog.skills.map((s) => [s.skill_id, s.grade_introduced]));
  const unknown = outside.filter((s) => !skillGrade.has(s));
  if (unknown.length) return { kind: 'out_of_scope', reason: 'unmapped_skill', skillIds: unknown };
  const above = outside.filter((s) => skillGrade.get(s)! > scope.grade);
  if (above.length) return { kind: 'out_of_scope', reason: 'beyond_grade', skillIds: above };
  if (problem.origin !== 'homework') return { kind: 'out_of_scope', reason: 'generated_not_covered', skillIds: outside };

  const current = catalog.lessons.filter((l) => l.subject === scope.subject && l.grade === scope.grade).sort((a, b) => a.seq - b.seq);
  let target: ScopeLesson | undefined;
  for (const skill of outside) {
    const first = current.find((l) => l.skill_ids.includes(skill));
    if (!first) return { kind: 'out_of_scope', reason: 'unmapped_skill', skillIds: [skill] };
    if (!target || first.seq > target.seq) target = first;
  }
  // Lớp học đúng thứ tự SGK: đề thuộc Bài X thì các bài giữa frontier và X cũng đã được dạy, nên mở
  // cả dải đó (chỉ cho riêng bài này; tiến độ vẫn chỉ đổi khi phụ huynh đồng ý gợi ý).
  const frontierSeq = scope.frontierLesson?.seq ?? 0;
  const lessons = current.filter(
    (l) => l.seq > frontierSeq && l.seq <= target!.seq && !scope.previewLessonIds.includes(l.lesson_id),
  );
  return {
    kind: 'homework_extension',
    extension: {
      lessonId: target!.lesson_id,
      lessonIds: lessons.map((l) => l.lesson_id),
      skillIds: uniq(lessons.flatMap((l) => l.skill_ids)),
      terms: lessons.flatMap((l) => l.introduces_terms),
      methods: uniq(lessons.flatMap((l) => l.methods)),
    },
  };
}

/** Phạm vi hiệu lực của MỘT bài về nhà: snapshot của phiên cộng phần mở thêm của riêng bài đó. */
export function applyHomeworkExtension(scope: CurriculumScope, extension: HomeworkExtension | null | undefined): CurriculumScope {
  if (!extension) return scope;
  const allowedSkillIds = uniq([...scope.allowedSkillIds, ...extension.skillIds]).sort();
  const allowedMethods = uniq([...scope.allowedMethods, ...extension.methods]);
  const next: Omit<CurriculumScope, 'scopeHash'> = {
    ...scope,
    allowedSkillIds,
    allowedTerms: uniq([...scope.allowedTerms, ...extension.terms.map((t) => t.term)]),
    allowedMethods,
    forbiddenTerms: subtractAllowed(scope.forbiddenTerms, extension.terms),
    forbiddenMethods: scope.forbiddenMethods.filter((m) => !allowedMethods.includes(m)),
    homeworkExtension: extension,
  };
  return { ...next, scopeHash: stableHash(next) };
}
