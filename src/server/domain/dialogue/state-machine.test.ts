import { describe, expect, it } from 'vitest';
import {
  initialState,
  nextState,
  type DialogueEvents,
  type DialoguePosition,
  type DialogueSignals,
  type DialogueState,
  type NextStateInput,
  type StudentStateGuess,
} from './state-machine';

// Input mặc định: một lượt "bình thường", không sự kiện, không tín hiệu, preset grade5 (threshold 2).
interface Overrides {
  mode?: NextStateInput['mode'];
  signals?: Partial<DialogueSignals>;
  events?: Partial<DialogueEvents>;
  safety?: Partial<NextStateInput['safety']>;
  escalationThreshold?: number;
  prerequisiteMastery?: Record<string, number>;
  studentStateGuess?: StudentStateGuess | null;
}

function input(state: DialogueState, scaffoldLevel: number, o: Overrides = {}): NextStateInput {
  return {
    current: { state, scaffoldLevel },
    mode: o.mode ?? 'solve',
    signals: { noProgressStreak: 0, frustrated: false, guessing: false, ...o.signals },
    events: {
      studentRequestedHint: false,
      stepCompleted: false,
      answerMatchesFinal: false,
      argueReasonGiven: false,
      explainedMethodOrMistake: false,
      parallelSolved: false,
      transferAnswered: false,
      transferSkipped: false,
      directTeachTurnsDone: 0,
      microLessonFinished: false,
      ...o.events,
    },
    safety: { guardSafety: false, adultNeeded: false, ...o.safety },
    escalationThreshold: o.escalationThreshold ?? 2,
    prerequisiteMastery: o.prerequisiteMastery ?? {},
    studentStateGuess: o.studentStateGuess ?? null,
  };
}

const run = (state: DialogueState, level: number, o?: Overrides) => nextState(input(state, level, o));

// Mọi vị trí hợp lệ, dùng cho các test "từ mọi trạng thái".
const ALL_POSITIONS: DialoguePosition[] = [
  { state: 'ELICIT', scaffoldLevel: 0 },
  { state: 'PROBE', scaffoldLevel: 0 },
  { state: 'PROBE', scaffoldLevel: 2 },
  { state: 'SCAFFOLD', scaffoldLevel: 1 },
  { state: 'SCAFFOLD', scaffoldLevel: 3 },
  { state: 'PARALLEL', scaffoldLevel: 4 },
  { state: 'DIRECT_TEACH', scaffoldLevel: 0 },
  { state: 'CONSOLIDATE', scaffoldLevel: 0 },
  { state: 'TRANSFER', scaffoldLevel: 0 },
  { state: 'DONE', scaffoldLevel: 0 },
  { state: 'PAUSE', scaffoldLevel: 0 },
];

describe('initialState', () => {
  it('phiên luôn mở bằng ELICIT, level 0', () => {
    expect(initialState()).toEqual({ state: 'ELICIT', scaffoldLevel: 0 });
  });
});

describe('ELICIT', () => {
  it('ELICIT → DIRECT_TEACH khi có skill tiền đề p_mastery < 0.4', () => {
    expect(run('ELICIT', 0, { prerequisiteMastery: { 'm5.frac': 0.8, 'm5.dec': 0.39 } })).toEqual({
      state: 'DIRECT_TEACH',
      scaffoldLevel: 0,
      reason: 'elicit_prerequisite_gap',
    });
  });

  it('ELICIT → PROBE khi mọi tiền đề ≥ 0.4 (0.4 đúng ngưỡng không tính là thiếu)', () => {
    expect(run('ELICIT', 0, { prerequisiteMastery: { a: 0.4, b: 0.9 } })).toMatchObject({
      state: 'PROBE',
      scaffoldLevel: 0,
      reason: 'elicit_to_probe',
    });
  });

  it('Giai đoạn 0: prerequisiteMastery rỗng → luôn PROBE, không vào DIRECT_TEACH', () => {
    expect(run('ELICIT', 0).state).toBe('PROBE');
  });
});

describe('DIRECT_TEACH → SCAFFOLD(1)', () => {
  it('ở lại khi chưa đủ 3 lượt, kể cả micro-lesson báo xong', () => {
    expect(run('DIRECT_TEACH', 0, { events: { directTeachTurnsDone: 2, microLessonFinished: true } })).toMatchObject(
      { state: 'DIRECT_TEACH', reason: 'direct_teach_continue' },
    );
  });

  it('sau 3 lượt khi micro-lesson đã xong', () => {
    expect(run('DIRECT_TEACH', 0, { events: { directTeachTurnsDone: 3, microLessonFinished: true } })).toEqual({
      state: 'SCAFFOLD',
      scaffoldLevel: 1,
      reason: 'direct_teach_done',
    });
  });

  it('3 lượt nhưng micro-lesson chưa xong thì dạy tiếp; tới lượt 4 thì bắt buộc chuyển', () => {
    expect(run('DIRECT_TEACH', 0, { events: { directTeachTurnsDone: 3 } }).state).toBe('DIRECT_TEACH');
    expect(run('DIRECT_TEACH', 0, { events: { directTeachTurnsDone: 4 } })).toMatchObject({
      state: 'SCAFFOLD',
      scaffoldLevel: 1,
    });
  });
});

describe('PROBE → SCAFFOLD(level+1)', () => {
  it('no_progress_streak ≥ escalation_threshold', () => {
    expect(run('PROBE', 0, { signals: { noProgressStreak: 1 } }).state).toBe('PROBE');
    expect(run('PROBE', 0, { signals: { noProgressStreak: 2 } })).toEqual({
      state: 'SCAFFOLD',
      scaffoldLevel: 1,
      reason: 'escalate_no_progress',
    });
  });

  it('tôn trọng threshold theo hồ sơ (3 thì 2 lượt chưa đủ)', () => {
    expect(run('PROBE', 0, { escalationThreshold: 3, signals: { noProgressStreak: 2 } }).state).toBe('PROBE');
    expect(run('PROBE', 0, { escalationThreshold: 3, signals: { noProgressStreak: 3 } }).state).toBe('SCAFFOLD');
  });

  it('tín hiệu nản', () => {
    expect(run('PROBE', 0, { signals: { frustrated: true } })).toMatchObject({
      state: 'SCAFFOLD',
      scaffoldLevel: 1,
      reason: 'escalate_frustration',
    });
  });

  it('con bấm "Gợi ý" (ưu tiên lý do hint khi có nhiều tín hiệu)', () => {
    expect(
      run('PROBE', 0, { events: { studentRequestedHint: true }, signals: { frustrated: true, noProgressStreak: 5 } }),
    ).toMatchObject({ state: 'SCAFFOLD', scaffoldLevel: 1, reason: 'escalate_hint' });
  });

  it('level giữ lại sau fading: PROBE(2) bế tắc → SCAFFOLD(3); PROBE(3) → SCAFFOLD(3) (trần)', () => {
    expect(run('PROBE', 2, { signals: { frustrated: true } }).scaffoldLevel).toBe(3);
    expect(run('PROBE', 3, { signals: { frustrated: true } })).toMatchObject({ state: 'SCAFFOLD', scaffoldLevel: 3 });
  });
});

describe('PROBE → CONSOLIDATE', () => {
  it('solve: đáp án khớp final_answer, level về 0', () => {
    expect(run('PROBE', 2, { events: { answerMatchesFinal: true } })).toEqual({
      state: 'CONSOLIDATE',
      scaffoldLevel: 0,
      reason: 'final_answer_matched',
    });
  });

  it('argue: con nêu lập luận có lý do', () => {
    expect(run('PROBE', 0, { mode: 'argue', events: { argueReasonGiven: true } })).toMatchObject({
      state: 'CONSOLIDATE',
      reason: 'argue_reason_given',
    });
  });

  it('sự kiện của chế độ khác bị bỏ qua', () => {
    expect(run('PROBE', 0, { mode: 'argue', events: { answerMatchesFinal: true } }).state).toBe('PROBE');
    expect(run('PROBE', 0, { mode: 'solve', events: { argueReasonGiven: true } }).state).toBe('PROBE');
  });

  it('đã khớp đáp án thì củng cố dù cùng lúc có tín hiệu bế tắc hay đoán bừa', () => {
    const r = run('PROBE', 0, {
      events: { answerMatchesFinal: true, studentRequestedHint: true },
      signals: { guessing: true, noProgressStreak: 4 },
    });
    expect(r.state).toBe('CONSOLIDATE');
  });
});

describe('PROBE: đoán bừa và lượt thường', () => {
  it('đoán bừa không tự chuyển trạng thái, chỉ đổi reason', () => {
    expect(run('PROBE', 1, { signals: { guessing: true } })).toEqual({
      state: 'PROBE',
      scaffoldLevel: 1,
      reason: 'probe_guessing',
    });
  });

  it('không sự kiện → ở lại PROBE', () => {
    expect(run('PROBE', 0)).toEqual({ state: 'PROBE', scaffoldLevel: 0, reason: 'probe_continue' });
  });
});

describe('SCAFFOLD', () => {
  it('SCAFFOLD → PROBE khi hoàn thành bước con; fading giảm level 1', () => {
    expect(run('SCAFFOLD', 3, { events: { stepCompleted: true } })).toEqual({
      state: 'PROBE',
      scaffoldLevel: 2,
      reason: 'scaffold_fade',
    });
    expect(run('SCAFFOLD', 1, { events: { stepCompleted: true } }).scaffoldLevel).toBe(0);
  });

  it('fading không bao giờ xuống dưới 0 qua nhiều vòng', () => {
    let pos: DialoguePosition = { state: 'SCAFFOLD', scaffoldLevel: 1 };
    for (let i = 0; i < 3; i++) {
      pos = nextState(input(pos.state, pos.scaffoldLevel, { events: { stepCompleted: true } }));
      expect(pos.scaffoldLevel).toBeGreaterThanOrEqual(0);
    }
    expect(pos).toMatchObject({ state: 'PROBE', scaffoldLevel: 0 });
  });

  it('bế tắc ở level 1–2 → lên level kế tiếp', () => {
    expect(run('SCAFFOLD', 1, { signals: { noProgressStreak: 2 } })).toMatchObject({
      state: 'SCAFFOLD',
      scaffoldLevel: 2,
      reason: 'escalate_no_progress',
    });
    expect(run('SCAFFOLD', 2, { events: { studentRequestedHint: true } }).scaffoldLevel).toBe(3);
  });

  it('SCAFFOLD(3) → PARALLEL (level 4) khi vẫn bế tắc', () => {
    for (const o of [
      { signals: { noProgressStreak: 2 } },
      { signals: { frustrated: true } },
      { events: { studentRequestedHint: true } },
    ]) {
      expect(run('SCAFFOLD', 3, o)).toEqual({ state: 'PARALLEL', scaffoldLevel: 4, reason: 'stuck_to_parallel' });
    }
  });

  it('chưa bế tắc, chưa xong bước → ở lại cùng level', () => {
    expect(run('SCAFFOLD', 2, { signals: { noProgressStreak: 1 } })).toEqual({
      state: 'SCAFFOLD',
      scaffoldLevel: 2,
      reason: 'scaffold_continue',
    });
  });

  it('hoàn thành bước con thắng tín hiệu bế tắc cùng lượt', () => {
    expect(run('SCAFFOLD', 3, { events: { stepCompleted: true }, signals: { frustrated: true } }).state).toBe(
      'PROBE',
    );
  });

  it('con tự ra đáp án cuối khi đang được gợi ý → CONSOLIDATE', () => {
    expect(run('SCAFFOLD', 2, { events: { answerMatchesFinal: true, stepCompleted: true } })).toMatchObject({
      state: 'CONSOLIDATE',
      scaffoldLevel: 0,
    });
  });
});

describe('PARALLEL → PROBE', () => {
  it('xong bài tương tự → quay về bài gốc, level giảm 1 (3)', () => {
    expect(run('PARALLEL', 4, { events: { parallelSolved: true } })).toEqual({
      state: 'PROBE',
      scaffoldLevel: 3,
      reason: 'parallel_solved',
    });
  });

  it('chưa xong → ở lại PARALLEL, không leo thêm dù bế tắc', () => {
    expect(run('PARALLEL', 4, { signals: { noProgressStreak: 9, frustrated: true } })).toEqual({
      state: 'PARALLEL',
      scaffoldLevel: 4,
      reason: 'parallel_continue',
    });
  });
});

describe('CONSOLIDATE → TRANSFER → DONE', () => {
  it('CONSOLIDATE ở lại khi con chưa giải thích được', () => {
    expect(run('CONSOLIDATE', 0).reason).toBe('consolidate_continue');
  });

  it('con giải thích được cách làm hoặc chỗ từng nhầm → TRANSFER', () => {
    expect(run('CONSOLIDATE', 0, { events: { explainedMethodOrMistake: true } })).toEqual({
      state: 'TRANSFER',
      scaffoldLevel: 0,
      reason: 'consolidate_explained',
    });
  });

  it('TRANSFER → DONE khi con trả lời câu chuyển giao', () => {
    expect(run('TRANSFER', 0, { events: { transferAnswered: true } })).toMatchObject({
      state: 'DONE',
      reason: 'transfer_answered',
    });
  });

  it('TRANSFER → DONE khi con bỏ qua', () => {
    expect(run('TRANSFER', 0, { events: { transferSkipped: true } })).toMatchObject({
      state: 'DONE',
      reason: 'transfer_skipped',
    });
  });

  it('TRANSFER chờ khi chưa trả lời, chưa bỏ qua', () => {
    expect(run('TRANSFER', 0).state).toBe('TRANSFER');
  });

  it('cả chuỗi CONSOLIDATE → DONE đi qua TRANSFER', () => {
    const t = run('CONSOLIDATE', 0, { events: { explainedMethodOrMistake: true } });
    expect(nextState(input(t.state, t.scaffoldLevel, { events: { transferAnswered: true } })).state).toBe('DONE');
  });
});

describe('* → PAUSE', () => {
  const live = ALL_POSITIONS.filter((p) => p.state !== 'PAUSE');

  it.each(live)('Guard SAFETY từ $state($scaffoldLevel) → PAUSE, giữ level', (pos) => {
    expect(run(pos.state, pos.scaffoldLevel, { safety: { guardSafety: true } })).toEqual({
      state: 'PAUSE',
      scaffoldLevel: pos.scaffoldLevel,
      reason: 'safety_pause',
    });
  });

  it.each(live)('tín hiệu cần người lớn từ $state($scaffoldLevel) → PAUSE', (pos) => {
    expect(run(pos.state, pos.scaffoldLevel, { safety: { adultNeeded: true } }).state).toBe('PAUSE');
  });

  it('safety thắng mọi sự kiện cùng lượt', () => {
    expect(run('PROBE', 0, { events: { answerMatchesFinal: true }, safety: { guardSafety: true } }).state).toBe(
      'PAUSE',
    );
  });
});

describe('trạng thái kết thúc', () => {
  const everything: Overrides = {
    signals: { noProgressStreak: 9, frustrated: true, guessing: true },
    events: {
      studentRequestedHint: true,
      stepCompleted: true,
      answerMatchesFinal: true,
      argueReasonGiven: true,
      explainedMethodOrMistake: true,
      parallelSolved: true,
      transferAnswered: true,
      transferSkipped: true,
      directTeachTurnsDone: 9,
      microLessonFinished: true,
    },
  };

  it('DONE không đi đâu với sự kiện thường', () => {
    expect(run('DONE', 0, everything)).toEqual({ state: 'DONE', scaffoldLevel: 0, reason: 'terminal' });
  });

  it('PAUSE không đi đâu, kể cả khi còn tín hiệu safety', () => {
    expect(run('PAUSE', 2, { ...everything, safety: { guardSafety: true } })).toEqual({
      state: 'PAUSE',
      scaffoldLevel: 2,
      reason: 'terminal',
    });
  });
});

describe('studentStateGuess chỉ là input yếu', () => {
  const guesses: StudentStateGuess[] = ['progressing', 'stuck', 'guessing', 'frustrated', 'done'];

  it.each(ALL_POSITIONS)('guess một mình không đổi kết quả ở $state($scaffoldLevel)', (pos) => {
    const baseline = run(pos.state, pos.scaffoldLevel);
    for (const g of guesses) {
      expect(run(pos.state, pos.scaffoldLevel, { studentStateGuess: g })).toEqual(baseline);
    }
  });

  it('guess "frustrated" sát ngưỡng không làm leo SCAFFOLD sớm', () => {
    expect(run('PROBE', 0, { signals: { noProgressStreak: 1 }, studentStateGuess: 'frustrated' }).state).toBe('PROBE');
  });
});

describe('validate input', () => {
  it.each([
    ['SCAFFOLD level 0', () => run('SCAFFOLD', 0)],
    ['SCAFFOLD level 4', () => run('SCAFFOLD', 4)],
    ['PARALLEL level 3', () => run('PARALLEL', 3)],
    ['PROBE level -1', () => run('PROBE', -1)],
    ['level không nguyên', () => run('PROBE', 1.5)],
    ['state lạ', () => run('BOGUS' as DialogueState, 0)],
    ['threshold 0', () => run('PROBE', 0, { escalationThreshold: 0 })],
    ['streak âm', () => run('PROBE', 0, { signals: { noProgressStreak: -1 } })],
    ['directTeachTurnsDone NaN', () => run('DIRECT_TEACH', 0, { events: { directTeachTurnsDone: Number.NaN } })],
    ['p_mastery > 1', () => run('ELICIT', 0, { prerequisiteMastery: { a: 1.2 } })],
    ['p_mastery NaN', () => run('ELICIT', 0, { prerequisiteMastery: { a: Number.NaN } })],
  ])('%s → RangeError', (_label, fn) => {
    expect(fn).toThrow(RangeError);
  });
});
