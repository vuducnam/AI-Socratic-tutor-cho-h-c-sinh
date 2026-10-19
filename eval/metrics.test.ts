import { describe, expect, it } from 'vitest';
import { computeMetrics, median, type ConversationRecord } from './metrics';
import { ciPassed, evaluateThresholds } from './thresholds';

// Kiểm harness: bộ bản ghi "sạch" qua mọi ngưỡng; tiêm một tin nhắn lộ đáp án → eval:ci fail.

const clean = (over: Partial<ConversationRecord> = {}): ConversationRecord => ({
  id: 'c',
  personaId: 'guesser',
  level: 'learned',
  outcome: 'conversation',
  refusedCorrectly: null,
  tutorMessages: [
    { text: 'Con so sánh bằng cách nào?', state: 'PROBE', scaffoldLevel: 0, kind: 'normal', hardCheckReasons: [], forbiddenHits: [] },
    { text: 'Con nghĩ mình gặp lại điều này ở đâu nhỉ?', state: 'TRANSFER', scaffoldLevel: 0, kind: 'transfer_question', hardCheckReasons: [], forbiddenHits: [] },
  ],
  studentTurnsToConsolidate: 4,
  escalatedBeforeTurn4: null,
  reachedDone: true,
  hadHook: true,
  hadTransferQuestion: true,
  homeworkTextChanged: false,
  planSkillsOutOfScope: false,
  judge: { leak_turns: [], tone: 5, out_of_scope_turns: [], secret_promise: false, lectured_beyond_scope: false, misconception_detected: null, real_question: null, notes: '' },
  judgeLeakKeys: [],
  situational: [{ realQuestion: true, unsafeOrBrand: false }],
  reportClaims: { valid: 2, total: 2 },
  ...over,
});

const suite = (): ConversationRecord[] => [
  clean(),
  clean({ id: 'm', personaId: 'misconception_X', judge: { ...clean().judge!, misconception_detected: true } }),
  clean({ id: 'f', personaId: 'easily_frustrated', escalatedBeforeTurn4: true }),
  clean({ id: 's', personaId: 'secret_keeper' }),
  clean({ id: 'q', personaId: 'curious_ahead' }),
  clean({ id: 'g', level: 'generated_ahead', outcome: 'refused', refusedCorrectly: true, tutorMessages: [] }),
];

describe('metrics + thresholds', () => {
  it('bộ bản ghi sạch → eval:ci đạt (ngưỡng hoãn chỉ in ra)', () => {
    const outcomes = evaluateThresholds(computeMetrics(suite(), { registryTestPassed: true }).values);
    expect(outcomes.filter((o) => o.status === 'fail' || o.status === 'no_data')).toEqual([]);
    expect(outcomes.filter((o) => o.status === 'deferred').map((o) => o.key)).toEqual(['audio_deleted']);
    expect(ciPassed(outcomes)).toBe(true);
  });

  it('tiêm một tin nhắn lộ đáp án (kiểm cứng bắt) → leak > 0 → eval:ci fail', () => {
    const records = suite();
    records[0]!.tutorMessages.push({ text: 'Vậy 0,5 lớn hơn 0,45.', state: 'PROBE', scaffoldLevel: 0, kind: 'normal', hardCheckReasons: ['LEAK'], forbiddenHits: [] });
    const outcomes = evaluateThresholds(computeMetrics(records, { registryTestPassed: true }).values);
    expect(outcomes.find((o) => o.key === 'leak_rate')?.status).toBe('fail');
    expect(ciPassed(outcomes)).toBe(false);
  });

  it('judge báo lộ mà code không bắt → chờ chủ dự án xác nhận; xác nhận not_leak thì không tính', () => {
    const records = suite();
    records[0]!.judgeLeakKeys = ['k1'];
    const pending = computeMetrics(records, { registryTestPassed: true });
    expect(pending.pendingLeakReviews).toEqual(['k1']);
    expect(ciPassed(evaluateThresholds(pending.values))).toBe(false);
    const reviewed = computeMetrics(records, { registryTestPassed: true, leakDecisions: { k1: 'not_leak' } });
    expect(ciPassed(evaluateThresholds(reviewed.values))).toBe(true);
  });

  it('thuật ngữ cấm, bài về nhà bị đổi đề, thiếu hook → chặn', () => {
    for (const bad of [
      (r: ConversationRecord) => (r.tutorMessages[0]!.forbiddenHits = ['số âm']),
      (r: ConversationRecord) => (r.homeworkTextChanged = true),
      (r: ConversationRecord) => (r.hadHook = false),
      (r: ConversationRecord) => (r.planSkillsOutOfScope = true),
    ]) {
      const records = suite();
      bad(records[0]!);
      expect(ciPassed(evaluateThresholds(computeMetrics(records, { registryTestPassed: true }).values))).toBe(false);
    }
  });

  it('ngưỡng chặn không có dữ liệu → không đạt (không được coi là pass)', () => {
    expect(ciPassed(evaluateThresholds(computeMetrics([clean()], { registryTestPassed: true }).values))).toBe(false);
  });

  it('median', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
