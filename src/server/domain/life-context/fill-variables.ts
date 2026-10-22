import 'server-only';
import { formatDecimalVi, type ThousandsSeparator } from '@/lib/vi-math-normalizer';
import { evaluateCondition, evaluateExpression, Fraction } from './exact-arithmetic';
import type { LifeContextTemplate } from './life-context-schema';

// Điền biến cho đề tình huống (SPEC §5b.3 bước 2): CODE sinh giá trị trong khoảng [min, max] theo step,
// chọn bộ số cho đáp án sạch (số thập phân hữu hạn ≤ max_answer_decimals chữ số) và thoả điều kiện.
// LLM không bao giờ tự đặt số.

export interface FilledVariables {
  /** Giá trị dạng máy (dấu chấm). */
  values: Record<string, string>;
  /** Giá trị hiển thị cho con (dấu phẩy, kèm đơn vị). */
  display: Record<string, string>;
  answer: string;
}

type Random = () => number;

function gridValue(min: number, max: number, step: number, random: Random): Fraction {
  const steps = Math.floor((max - min) / step + 1e-9);
  const k = Math.floor(random() * (steps + 1));
  return Fraction.ofNumber(min).add(Fraction.ofNumber(step).mul(Fraction.ofNumber(k)));
}

/** Template có biến bước lẻ (0,5; 0,05…) là bài luyện số thập phân. */
function wantsDecimal(template: LifeContextTemplate): boolean {
  return Object.values(template.variables).some((v) => !Number.isInteger(v.step) || !Number.isInteger(v.min));
}

export function fillVariables(template: LifeContextTemplate, options: { random?: Random; maxTries?: number; thousands?: ThousandsSeparator } = {}): FilledVariables {
  const random = options.random ?? Math.random;
  const tries = options.maxTries ?? 500;
  const needsDecimal = wantsDecimal(template);
  for (let attempt = 0; attempt < tries; attempt++) {
    const vars: Record<string, Fraction> = {};
    for (const [name, v] of Object.entries(template.variables)) vars[name] = gridValue(v.min, v.max, v.step, random);
    // Bài luyện số thập phân mà rút trúng toàn số tròn (ví dụ 200 m − 145 m) thì không luyện được kỹ năng: rút lại.
    if (needsDecimal && Object.values(vars).every((f) => (f.decimalPlaces() ?? 0) === 0)) continue;
    let answer: Fraction;
    try {
      if (!template.conditions.every((c) => evaluateCondition(c, vars))) continue;
      answer = evaluateExpression(template.answer_expression, vars);
    } catch {
      continue;
    }
    const places = answer.decimalPlaces();
    if (places === null || places > template.max_answer_decimals) continue;
    if (answer.compare(new Fraction(0n, 1n)) < 0) continue;
    const values = Object.fromEntries(Object.entries(vars).map(([k, f]) => [k, f.toDecimalString()]));
    const display = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, `${formatDecimalVi(v, { thousands: options.thousands })}${template.variables[k]!.unit ? ` ${template.variables[k]!.unit}` : ''}`]),
    );
    return { values, display, answer: answer.toDecimalString() };
  }
  throw new Error('Không tìm được bộ số cho đáp án sạch trong khoảng đã khai báo');
}

/** Thay {biến} trong câu bằng giá trị hiển thị (bản nháp trước khi contextualize viết thành lời). */
export function renderTemplateText(text: string, display: Record<string, string>): string {
  return text.replace(/\{([a-z][a-z0-9_]*)\}/g, (_m, k: string) => display[k] ?? `{${k}}`);
}

/** Mọi giá trị biến nằm trong khoảng khai báo và đúng lưới step (kiểm lại sau khi đã lưu). */
export function valuesWithinRanges(template: LifeContextTemplate, values: Record<string, string>): boolean {
  return Object.entries(template.variables).every(([k, v]) => {
    const raw = values[k];
    if (raw === undefined) return false;
    const x = Fraction.of(raw);
    if (x.compare(Fraction.ofNumber(v.min)) < 0 || x.compare(Fraction.ofNumber(v.max)) > 0) return false;
    const k2 = x.sub(Fraction.ofNumber(v.min)).div(Fraction.ofNumber(v.step));
    return k2.d === 1n;
  });
}
