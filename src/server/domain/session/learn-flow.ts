import 'server-only';
import type { Actor } from '@/server/dal/actor';
import { loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { confirmProblemText, createProblem, getProblem } from '@/server/dal/problems-dal';
import { endLearningSession, findOpenSession, getLearningSession, getStudentContext, listSessionsSince } from '@/server/dal/sessions-dal';
import { listSchoolProgress } from '@/server/dal/school-progress-dal';
import { listSessionTurns } from '@/server/dal/turns-dal';
import { enqueueSessionReport } from '@/server/jobs/enqueue-session-report';
import { findSubject, loadSubjects, type SubjectConfig } from '@/server/domain/curriculum/subject-config';
import { loadPreset } from '@/server/domain/dialogue/preset';
import { openProblemTurn, type TurnResult } from '@/server/domain/dialogue/run-turn';
import { extractProblemFromImage } from '@/server/domain/input/extract-problem-from-image';
import { sanitizeProblemImage, type CropRect } from '@/server/domain/input/sanitize-problem-image';
import { presolveProblem } from '@/server/domain/presolve/presolve';
import { openLearningSession } from './open-session';
import { withStudentStartLock } from './student-start-lock';
import { DAILY_LIMIT_MESSAGE, learningPrefsLimits, minutesUsed, SESSION_LIMIT_MESSAGE, startOfVietnamDay } from './usage-limits';

// Luồng của trang /learn (SPEC §6, §11.5, §13): mở/tiếp tục phiên, nộp đề (gõ tay hoặc ảnh → con xác nhận),
// Pre-solver, mở bài; giới hạn thời gian theo hồ sơ. Route handler chỉ xác thực → zod → gọi các hàm này.

export const IDLE_SESSION_MINUTES = 30;

export interface ChatLine {
  turnId: string;
  from: 'cu' | 'student';
  text: string;
  kind: string;
}

/** Môn gửi cho client: tên hiển thị và có bàn phím toán không (config/subjects.yaml). */
export interface SubjectDto {
  id: string;
  name: string;
  mathKeyboard: boolean;
}

export type StartResult =
  | {
      ok: true;
      sessionId: string;
      subject: SubjectDto;
      /** Mọi môn đã đặt tiến độ (từ hai môn thì /learn có nút "Đổi môn"). */
      subjects: SubjectDto[];
      lines: ChatLine[];
      state: string | null;
      hasProblem: boolean;
      minutesLeft: number;
    }
  | { ok: false; reason: 'progress_missing' | 'daily_limit'; message: string }
  /** Con có từ hai môn đã đặt tiến độ và chưa chọn môn: client hiện màn chọn môn. */
  | { ok: false; reason: 'choose_subject'; subjects: SubjectDto[] };

const toSubjectDto = (s: SubjectConfig): SubjectDto => ({ id: s.id, name: s.name, mathKeyboard: s.math_keyboard });

/** Môn trong config mà bố mẹ đã đặt tiến độ (con trỏ hoặc cho học trước), theo thứ tự trong config. */
async function subjectsWithProgress(actor: Actor, studentId: string): Promise<SubjectConfig[]> {
  const rows = await listSchoolProgress(actor, { studentId });
  const ready = new Set(rows.filter((r) => r.frontier_lesson_id || r.preview_lesson_ids.length).map((r) => r.subject));
  return loadSubjects().filter((s) => ready.has(s.id));
}

async function remainingMinutes(actor: Actor, studentId: string) {
  const student = await getStudentContext(actor, { studentId });
  const limits = learningPrefsLimits(student.learning_prefs, loadPreset(student.preset));
  const used = minutesUsed(await listSessionsSince(actor, { studentId, since: startOfVietnamDay() }));
  return { student, limits, left: Math.floor(limits.dailyMinutes - used) };
}

function toLines(turns: { id: string; role: string; content: string; turn_kind: string }[]): ChatLine[] {
  return turns.map((t) => ({ turnId: t.id, from: t.role === 'student' ? 'student' : 'cu', text: t.content, kind: t.turn_kind }));
}

/**
 * Mở hoặc tiếp tục phiên. `subject` bỏ trống: tiếp tục phiên đang mở (mọi môn); không có thì con chỉ có một môn đã
 * đặt tiến độ → mở môn đó, có từ hai môn → trả danh sách để con chọn. Chọn môn khác môn đang mở → đóng phiên cũ.
 */
export async function startOrResumeSession(actor: Actor, input: { studentId: string; subject?: string }): Promise<StartResult> {
  // Tuần tự theo học sinh: hai lần mở cùng lúc không tạo hai phiên (student-start-lock.ts).
  return withStudentStartLock(input.studentId, () => startOrResumeUnlocked(actor, input));
}

async function startOrResumeUnlocked(actor: Actor, input: { studentId: string; subject?: string }): Promise<StartResult> {
  const { left } = await remainingMinutes(actor, input.studentId);
  if (left <= 0) return { ok: false, reason: 'daily_limit', message: DAILY_LIMIT_MESSAGE };

  const ready = await subjectsWithProgress(actor, input.studentId);
  const subjects = ready.map(toSubjectDto);
  const open = await findOpenSession(actor, { studentId: input.studentId });
  if (open && input.subject && open.subject !== input.subject) {
    await closeSession(actor, { studentId: input.studentId, sessionId: open.id, reason: 'switch_subject' });
  } else if (open) {
    const session = await getLearningSession(actor, { studentId: input.studentId, sessionId: open.id });
    if (Date.now() - session.last_activity_at.getTime() < IDLE_SESSION_MINUTES * 60_000) {
      const turns = await listSessionTurns(actor, { studentId: input.studentId, sessionId: open.id });
      return {
        ok: true,
        sessionId: open.id,
        subject: subjectDtoFor(open.subject),
        subjects,
        lines: toLines(turns),
        state: [...turns].reverse().find((t) => t.role !== 'student')?.state_after ?? null,
        hasProblem: turns.length > 0,
        minutesLeft: left,
      };
    }
    await closeSession(actor, { studentId: input.studentId, sessionId: open.id, reason: 'timeout' });
  }
  let subject = input.subject ? findSubject(input.subject) : null;
  if (!subject) {
    if (ready.length > 1) return { ok: false, reason: 'choose_subject', subjects };
    // Chưa môn nào có tiến độ: mở thử môn đầu tiên để openLearningSession ghi cờ progress_missing cho bố mẹ.
    subject = ready[0] ?? loadSubjects()[0]!;
  }
  const opened = await openLearningSession(actor, { studentId: input.studentId, subject: subject.id });
  if (!opened.ok) return { ok: false, reason: 'progress_missing', message: opened.message };
  return { ok: true, sessionId: opened.sessionId, subject: toSubjectDto(subject), subjects, lines: [], state: null, hasProblem: false, minutesLeft: left };
}

/** Phiên mở theo môn không còn trong config (môn thử trong test): hiện đúng mã môn, có bàn phím toán như trước. */
function subjectDtoFor(id: string): SubjectDto {
  const subject = findSubject(id);
  return subject ? toSubjectDto(subject) : { id, name: id, mathKeyboard: true };
}

export type ProblemStartResult = { ok: true; turn: TurnResult } | { ok: false; message: string; reason: string };

async function presolveAndOpen(actor: Actor, input: { studentId: string; sessionId: string; problemId: string; text: string }): Promise<ProblemStartResult> {
  const session = await getLearningSession(actor, { studentId: input.studentId, sessionId: input.sessionId });
  const student = await getStudentContext(actor, { studentId: input.studentId });
  const presolved = await presolveProblem(actor, {
    studentId: input.studentId,
    sessionId: input.sessionId,
    problemId: input.problemId,
    problemText: input.text,
    origin: 'homework',
    sessionScope: session.scope_snapshot,
    catalog: await loadScopeCatalog(session.subject, student.grade),
  });
  if (!presolved.ok) return { ok: false, message: presolved.message, reason: presolved.reason };
  return { ok: true, turn: await openProblemTurn(actor, { studentId: input.studentId, sessionId: input.sessionId }) };
}

async function assertTimeLeft(actor: Actor, studentId: string, sessionId: string): Promise<string | null> {
  const { left, limits } = await remainingMinutes(actor, studentId);
  if (left <= 0) return DAILY_LIMIT_MESSAGE;
  const session = await getLearningSession(actor, { studentId, sessionId });
  if ((Date.now() - session.started_at.getTime()) / 60_000 > limits.sessionMinutes) return SESSION_LIMIT_MESSAGE;
  return null;
}

/**
 * Con gõ hoặc đọc đề bài về nhà: đề con gửi chính là confirmed_text (giữ nguyên, SPEC §5b.2). Đọc bằng giọng thì
 * chữ STT gốc (trước khi con sửa) lưu ở extracted_text, giống chữ đọc từ ảnh.
 */
export async function submitTypedProblem(
  actor: Actor,
  input: { studentId: string; sessionId: string; text: string; rawStt?: string | null },
): Promise<ProblemStartResult> {
  const limit = await assertTimeLeft(actor, input.studentId, input.sessionId);
  if (limit) return { ok: false, message: limit, reason: 'time_limit' };
  const problemId = await createProblem(actor, {
    studentId: input.studentId,
    sessionId: input.sessionId,
    origin: 'homework',
    extractedText: input.rawStt ?? null,
    confirmedText: input.text,
    confirmedByStudent: true,
  });
  return presolveAndOpen(actor, { studentId: input.studentId, sessionId: input.sessionId, text: input.text, problemId });
}

/** Ảnh đề: làm sạch + cắt vùng → OCR → trả đề để con xác nhận (chưa giải). */
export async function uploadProblemImage(
  actor: Actor,
  input: { studentId: string; sessionId: string; bytes: Uint8Array; crop: CropRect | null },
): Promise<{ problemId: string; extractedText: string; readable: boolean }> {
  const student = await getStudentContext(actor, { studentId: input.studentId });
  const image = await sanitizeProblemImage(input.bytes, input.crop);
  const ocr = await extractProblemFromImage({
    studentId: input.studentId,
    sessionId: input.sessionId,
    grade: student.grade,
    image: { mediaType: image.mediaType, base64: image.bytes.toString('base64'), storageUri: image.storageUri },
  });
  const problemId = await createProblem(actor, {
    studentId: input.studentId,
    sessionId: input.sessionId,
    origin: 'homework',
    imageUri: image.storageUri,
    extractedText: ocr.problem_text,
  });
  return { problemId, extractedText: ocr.problem_text, readable: ocr.readable };
}

/** Con xác nhận (và sửa nếu cần) đề đọc từ ảnh → từ đây đề không đổi. */
export async function confirmImageProblem(
  actor: Actor,
  input: { studentId: string; sessionId: string; problemId: string; text: string },
): Promise<ProblemStartResult> {
  const problem = await getProblem(actor, { studentId: input.studentId, problemId: input.problemId });
  if (problem.session_id !== input.sessionId) throw new Error('Đề không thuộc phiên này');
  await confirmProblemText(actor, { studentId: input.studentId, problemId: input.problemId, confirmedText: input.text });
  return presolveAndOpen(actor, input);
}

export async function closeSession(actor: Actor, input: { studentId: string; sessionId: string; reason: 'student_done' | 'timeout' | 'time_limit' | 'switch_subject' }) {
  const closed = await endLearningSession(actor, input);
  if (closed) await enqueueSessionReport({ studentId: input.studentId, sessionId: input.sessionId });
  return closed;
}

export { assertTimeLeft };
