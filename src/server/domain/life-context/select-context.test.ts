import { describe, expect, it } from 'vitest';
import { fillVariables, valuesWithinRanges } from './fill-variables';
import { evaluateExpression, Fraction } from './exact-arithmetic';
import type { LifeContextTemplate, Theme } from './life-context-schema';
import { selectContext, themesForInterests, type SelectableContext } from './select-context';

const ctx = (id: string, theme: Theme, over: Partial<SelectableContext> = {}): SelectableContext => ({
  id,
  skill_id: 'S.DEC',
  theme,
  min_grade: 5,
  max_grade: 5,
  approved: true,
  ...over,
});
const LIB = [ctx('A', 'market'), ctx('B', 'sport'), ctx('C', 'nature'), ctx('D', 'cooking'), ctx('E', 'animals')];
const base = { targetSkillIds: ['S.DEC'], allowedSkillIds: ['S.DEC'], grade: 5, interests: [] as string[], recentUses: [], now: new Date('2026-10-19T08:00:00Z'), random: () => 0 };
const daysAgo = (n: number) => new Date(base.now.getTime() - n * 24 * 3600_000);

describe('selectContext', () => {
  it('chỉ context đã duyệt, đúng skill, skill đã học, đúng lớp', () => {
    const contexts = [ctx('X', 'sport', { approved: false }), ctx('Y', 'sport', { skill_id: 'S.OTHER' }), ctx('Z', 'sport', { min_grade: 6, max_grade: 6 }), ctx('OK', 'home')];
    expect(selectContext({ ...base, contexts })).toMatchObject({ ok: true, context: { id: 'OK' } });
  });

  it('skill chưa học → không bao giờ chọn context của skill đó', () => {
    expect(selectContext({ ...base, contexts: LIB, allowedSkillIds: [] })).toEqual({ ok: false, reason: 'context_pool_exhausted' });
  });

  it('ưu tiên theme khớp sở thích', () => {
    expect(selectContext({ ...base, contexts: LIB, interests: ['bóng đá'] })).toMatchObject({ context: { theme: 'sport' } });
    expect(themesForInterests(['trồng cây', 'xếp hình'])).toEqual(['nature', 'game']);
  });

  it('xoay vòng theme: không lặp theme trong 3 bài gần nhất', () => {
    const recentUses = [
      { contextId: 'A', theme: 'market' as Theme, usedAt: daysAgo(10) },
      { contextId: 'B', theme: 'sport' as Theme, usedAt: daysAgo(10) },
      { contextId: 'C', theme: 'nature' as Theme, usedAt: daysAgo(10) },
    ];
    for (let i = 0; i < 10; i++) {
      const r = selectContext({ ...base, contexts: LIB, recentUses, random: () => i / 10 });
      expect(r.ok && ['cooking', 'animals'].includes(r.context.theme)).toBe(true);
    }
  });

  it('không dùng lại context trong 7 ngày; thư viện cạn thì nới dần', () => {
    const two = [ctx('A', 'market'), ctx('B', 'sport')];
    const used = [{ contextId: 'A', theme: 'market' as Theme, usedAt: daysAgo(2) }];
    expect(selectContext({ ...base, contexts: two, recentUses: used })).toMatchObject({ context: { id: 'B' }, relaxation: 'none' });
    const both = [...used, { contextId: 'B', theme: 'sport' as Theme, usedAt: daysAgo(1) }];
    // Theme của cả hai nằm trong 3 bài gần nhất và đều dùng trong 7 ngày → dùng lại cái cũ nhất.
    expect(selectContext({ ...base, contexts: two, recentUses: both })).toMatchObject({ context: { id: 'A' }, relaxation: 'reuse_oldest' });
  });

  it('context đã thử fail trong lượt bị loại; hết thì báo cạn', () => {
    expect(selectContext({ ...base, contexts: [ctx('A', 'market')], exclude: ['A'] })).toEqual({ ok: false, reason: 'context_pool_exhausted' });
  });
});

const template = (over: Partial<LifeContextTemplate> = {}): LifeContextTemplate => ({
  setup: 'Mẹ mua {a} kg cam và {b} kg táo.',
  real_question: 'Mẹ xách tất cả bao nhiêu ki-lô-gam?',
  variables: { a: { min: 1.2, max: 3.8, step: 0.1, unit: 'kg' }, b: { min: 0.5, max: 2.5, step: 0.25, unit: 'kg' } },
  answer_expression: 'a + b',
  max_answer_decimals: 2,
  conditions: [],
  svg_kind: 'segment_bar',
  ...over,
});

describe('fillVariables', () => {
  it('số học chính xác: 0,1 + 0,2 = 0,3', () => {
    expect(evaluateExpression('a + b', { a: Fraction.of('0.1'), b: Fraction.of('0.2') }).toDecimalString()).toBe('0.3');
  });

  it('mọi giá trị nằm trong khoảng variables và đúng lưới step', () => {
    for (let i = 0; i < 200; i++) {
      const f = fillVariables(template());
      expect(valuesWithinRanges(template(), f.values)).toBe(true);
      expect(Number(f.answer)).toBeCloseTo(Number(f.values.a) + Number(f.values.b), 10);
      expect(f.display.a).toMatch(/^\d+(,\d+)? kg$/);
    }
  });

  it('phép chia chỉ chọn bộ số cho đáp án thập phân hữu hạn ≤ 2 chữ số', () => {
    const t = template({ answer_expression: 'a / b', variables: { a: { min: 1, max: 20, step: 1, unit: '' }, b: { min: 3, max: 9, step: 1, unit: '' } } });
    for (let i = 0; i < 100; i++) {
      const f = fillVariables(t);
      expect(f.answer).toMatch(/^\d+(\.\d{1,2})?$/);
    }
  });

  it('điều kiện giữa các biến được tôn trọng', () => {
    const t = template({ conditions: ['a > b'], answer_expression: 'a - b' });
    for (let i = 0; i < 100; i++) {
      const f = fillVariables(t);
      expect(Number(f.values.a)).toBeGreaterThan(Number(f.values.b));
    }
  });

  it('không tìm được bộ số → lỗi rõ ràng', () => {
    const t = template({ answer_expression: 'a / b', max_answer_decimals: 0, variables: { a: { min: 1, max: 1, step: 1, unit: '' }, b: { min: 3, max: 3, step: 1, unit: '' } } });
    expect(() => fillVariables(t, { maxTries: 20 })).toThrow(/đáp án sạch/);
  });
});
