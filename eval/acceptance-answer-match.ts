import { normalizeNumber } from '@/server/domain/dialogue/hard-checks';

// So đáp án Pre-solver với đáp án của bộ đề nghiệm thu.
// - Số: so theo giá trị ("9.40" = "9.4"), không so chuỗi.
// - Lựa chọn (kind choice): canonical là chỉ số lựa chọn nên so nhãn (choice_label) với đáp án hiển thị.

export interface PresolveFinalAnswer {
  canonical: string | string[];
  kind: string;
  choice_label: string | null;
}

export interface ExpectedAnswer {
  display: string;
  machine: string[];
}

const normalizeLabel = (s: string) => s.normalize('NFC').toLowerCase().trim();

export function presolveAnswerMatches(answer: PresolveFinalAnswer, expected: ExpectedAnswer): boolean {
  if (answer.kind === 'choice') {
    const label = answer.choice_label ? normalizeLabel(answer.choice_label) : '';
    return label.length > 0 && normalizeLabel(expected.display).includes(label);
  }
  const got = [answer.canonical].flat().map(normalizeNumber);
  const want = expected.machine.map(normalizeNumber);
  return got.length === want.length && got.every((v, i) => v === want[i]);
}
