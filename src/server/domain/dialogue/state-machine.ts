import 'server-only';

// State machine hội thoại (SPEC §7, quy tắc cứng 7): mọi chuyển trạng thái là rule trong code.
// Hàm thuần: không DB, không LLM, cùng input luôn cho cùng output.
//
// Mức hỗ trợ `scaffoldLevel`:
// - SCAFFOLD: 1–3; PARALLEL: 4 (bài tương tự).
// - PROBE: 0–3, là mức đã giảm dần sau fading; lần bế tắc tiếp theo lên SCAFFOLD(level + 1), tối đa 3.
// - PARALLEL → PROBE: giảm 1 như fading (về 3).
// - ELICIT, DIRECT_TEACH, CONSOLIDATE, TRANSFER, DONE: 0. PAUSE giữ nguyên mức lúc dừng (để ghi log).
//
// `studentStateGuess` của Tutor KHÔNG được dùng cho bất kỳ chuyển trạng thái nào: nó chỉ đi kèm input
// để orchestrator ghi log cạnh quyết định của code. Tín hiệu nản/đoán bừa do `signals.ts` tính từ text
// và thời gian thật, không lấy từ phán đoán của model.

export type DialogueState =
  | 'ELICIT'
  | 'PROBE'
  | 'SCAFFOLD'
  | 'PARALLEL'
  | 'DIRECT_TEACH'
  | 'CONSOLIDATE'
  | 'TRANSFER'
  | 'DONE'
  | 'PAUSE';

export type DialogueMode = 'solve' | 'argue';
export type StudentStateGuess = 'progressing' | 'stuck' | 'guessing' | 'frustrated' | 'done';

export interface DialoguePosition {
  state: DialogueState;
  scaffoldLevel: number;
}

export interface DialogueSignals {
  noProgressStreak: number;
  frustrated: boolean;
  guessing: boolean;
}

/** Sự kiện của lượt vừa rồi, do code xác định (so đáp án chuẩn hoá, bấm nút "Gợi ý", ...). */
export interface DialogueEvents {
  studentRequestedHint: boolean;
  stepCompleted: boolean;
  answerMatchesFinal: boolean;
  argueReasonGiven: boolean;
  explainedMethodOrMistake: boolean;
  parallelSolved: boolean;
  transferAnswered: boolean;
  transferSkipped: boolean;
  /** Số lượt micro-lesson đã dạy trong DIRECT_TEACH (gồm lượt vừa rồi). */
  directTeachTurnsDone: number;
  /** Micro-lesson đã đủ nội dung (cho phép rời DIRECT_TEACH sau 3 lượt thay vì 4). */
  microLessonFinished: boolean;
}

export interface DialogueSafety {
  /** Guard trả lý do SAFETY. */
  guardSafety: boolean;
  /** Phát hiện tín hiệu cần người lớn (code hoặc Guard). */
  adultNeeded: boolean;
}

export interface NextStateInput {
  current: DialoguePosition;
  mode: DialogueMode;
  signals: DialogueSignals;
  events: DialogueEvents;
  safety: DialogueSafety;
  escalationThreshold: number;
  /** p_mastery của các skill tiền đề (skillId → 0..1). Giai đoạn 0 truyền {} nên không vào DIRECT_TEACH. */
  prerequisiteMastery: Readonly<Record<string, number>>;
  /** Phán đoán của Tutor: chỉ ghi log, không ảnh hưởng kết quả. */
  studentStateGuess: StudentStateGuess | null;
}

export type TransitionReason =
  | 'safety_pause'
  | 'terminal'
  | 'elicit_prerequisite_gap'
  | 'elicit_to_probe'
  | 'direct_teach_continue'
  | 'direct_teach_done'
  | 'final_answer_matched'
  | 'argue_reason_given'
  | 'escalate_hint'
  | 'escalate_frustration'
  | 'escalate_no_progress'
  | 'stuck_to_parallel'
  | 'probe_guessing'
  | 'probe_continue'
  | 'scaffold_fade'
  | 'scaffold_continue'
  | 'parallel_solved'
  | 'parallel_continue'
  | 'consolidate_explained'
  | 'consolidate_continue'
  | 'transfer_answered'
  | 'transfer_skipped'
  | 'transfer_continue';

export interface NextStateResult extends DialoguePosition {
  reason: TransitionReason;
}

export const PREREQUISITE_MASTERY_MIN = 0.4;
export const DIRECT_TEACH_MIN_TURNS = 3;
export const DIRECT_TEACH_MAX_TURNS = 4;
export const MAX_SCAFFOLD_LEVEL = 3;
export const PARALLEL_LEVEL = 4;

/** Phiên luôn mở bằng ELICIT (lượt `hook` câu tình huống đời thật). */
export function initialState(): DialoguePosition {
  return { state: 'ELICIT', scaffoldLevel: 0 };
}

const LEVEL_RANGE: Readonly<Record<DialogueState, readonly [number, number]>> = {
  ELICIT: [0, 0],
  PROBE: [0, MAX_SCAFFOLD_LEVEL],
  SCAFFOLD: [1, MAX_SCAFFOLD_LEVEL],
  PARALLEL: [PARALLEL_LEVEL, PARALLEL_LEVEL],
  DIRECT_TEACH: [0, 0],
  CONSOLIDATE: [0, 0],
  TRANSFER: [0, 0],
  DONE: [0, 0],
  PAUSE: [0, PARALLEL_LEVEL],
};

function assertValidInput(input: NextStateInput): void {
  const { current, escalationThreshold, signals, prerequisiteMastery } = input;
  // State đọc từ DB có thể là chuỗi lạ: kiểm tra cả khi kiểu đã hẹp.
  const range: readonly [number, number] | undefined = LEVEL_RANGE[current.state];
  if (range === undefined) throw new RangeError(`state không hợp lệ: ${String(current.state)}`);
  if (!Number.isInteger(current.scaffoldLevel)) {
    throw new RangeError(`scaffoldLevel không hợp lệ: ${String(current.scaffoldLevel)}`);
  }
  if (current.scaffoldLevel < range[0] || current.scaffoldLevel > range[1]) {
    throw new RangeError(`scaffoldLevel ${current.scaffoldLevel} không hợp lệ cho ${current.state}`);
  }
  if (!Number.isInteger(escalationThreshold) || escalationThreshold < 1) {
    throw new RangeError(`escalationThreshold phải là số nguyên ≥ 1: ${escalationThreshold}`);
  }
  if (!Number.isInteger(signals.noProgressStreak) || signals.noProgressStreak < 0) {
    throw new RangeError(`noProgressStreak phải là số nguyên ≥ 0: ${signals.noProgressStreak}`);
  }
  if (!Number.isInteger(input.events.directTeachTurnsDone) || input.events.directTeachTurnsDone < 0) {
    throw new RangeError(`directTeachTurnsDone phải là số nguyên ≥ 0: ${input.events.directTeachTurnsDone}`);
  }
  for (const [skillId, p] of Object.entries(prerequisiteMastery)) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new RangeError(`p_mastery của ${skillId} phải trong [0, 1]: ${p}`);
    }
  }
}

const at = (state: DialogueState, scaffoldLevel: number, reason: TransitionReason): NextStateResult => ({
  state,
  scaffoldLevel,
  reason,
});

/** Lý do bế tắc theo thứ tự ưu tiên: bấm "Gợi ý" > nản > không tiến triển; null nếu không bế tắc. */
function stuckReason(input: NextStateInput): TransitionReason | null {
  if (input.events.studentRequestedHint) return 'escalate_hint';
  if (input.signals.frustrated) return 'escalate_frustration';
  if (input.signals.noProgressStreak >= input.escalationThreshold) return 'escalate_no_progress';
  return null;
}

/** Bài gốc đã xong theo chế độ: solve khớp `final_answer`, argue nêu được lập luận có lý do. */
function solvedReason(input: NextStateInput): TransitionReason | null {
  if (input.mode === 'solve' && input.events.answerMatchesFinal) return 'final_answer_matched';
  if (input.mode === 'argue' && input.events.argueReasonGiven) return 'argue_reason_given';
  return null;
}

/** Tính trạng thái tiếp theo sau một lượt của con. */
export function nextState(input: NextStateInput): NextStateResult {
  assertValidInput(input);
  const { current, events } = input;
  const level = current.scaffoldLevel;

  if (current.state === 'PAUSE') return at('PAUSE', level, 'terminal');
  if (input.safety.guardSafety || input.safety.adultNeeded) return at('PAUSE', level, 'safety_pause');

  switch (current.state) {
    case 'DONE':
      return at('DONE', 0, 'terminal');

    case 'ELICIT': {
      const gap = Object.values(input.prerequisiteMastery).some((p) => p < PREREQUISITE_MASTERY_MIN);
      return gap ? at('DIRECT_TEACH', 0, 'elicit_prerequisite_gap') : at('PROBE', 0, 'elicit_to_probe');
    }

    case 'DIRECT_TEACH': {
      const turns = events.directTeachTurnsDone;
      const done =
        turns >= DIRECT_TEACH_MAX_TURNS || (turns >= DIRECT_TEACH_MIN_TURNS && events.microLessonFinished);
      return done ? at('SCAFFOLD', 1, 'direct_teach_done') : at('DIRECT_TEACH', 0, 'direct_teach_continue');
    }

    case 'PROBE': {
      const solved = solvedReason(input);
      if (solved) return at('CONSOLIDATE', 0, solved);
      const stuck = stuckReason(input);
      if (stuck) return at('SCAFFOLD', Math.min(level + 1, MAX_SCAFFOLD_LEVEL), stuck);
      // Đoán bừa không có dòng chuyển riêng trong SPEC §7: giữ PROBE, lý do riêng để Tutor chậm lại.
      return at('PROBE', level, input.signals.guessing ? 'probe_guessing' : 'probe_continue');
    }

    case 'SCAFFOLD': {
      // Con đã tự ra đáp án cuối khi đang được gợi ý thì không bắt quay lại PROBE rồi mới củng cố.
      const solved = solvedReason(input);
      if (solved) return at('CONSOLIDATE', 0, solved);
      if (events.stepCompleted) return at('PROBE', Math.max(level - 1, 0), 'scaffold_fade');
      const stuck = stuckReason(input);
      if (stuck === null) return at('SCAFFOLD', level, 'scaffold_continue');
      if (level >= MAX_SCAFFOLD_LEVEL) return at('PARALLEL', PARALLEL_LEVEL, 'stuck_to_parallel');
      return at('SCAFFOLD', level + 1, stuck);
    }

    case 'PARALLEL':
      return events.parallelSolved
        ? at('PROBE', PARALLEL_LEVEL - 1, 'parallel_solved')
        : at('PARALLEL', PARALLEL_LEVEL, 'parallel_continue');

    case 'CONSOLIDATE':
      return events.explainedMethodOrMistake
        ? at('TRANSFER', 0, 'consolidate_explained')
        : at('CONSOLIDATE', 0, 'consolidate_continue');

    case 'TRANSFER':
      if (events.transferAnswered) return at('DONE', 0, 'transfer_answered');
      if (events.transferSkipped) return at('DONE', 0, 'transfer_skipped');
      return at('TRANSFER', 0, 'transfer_continue');
  }
}
