import { describe, expect, it } from 'vitest';
import canonicalCases from './cases/to-canonical.json';
import machineCases from './cases/to-machine.json';
import roundTripCases from './cases/round-trip.json';
import spokenCases from './cases/to-spoken.json';
import { toCanonical, toMachine, toSpoken } from './index';

interface CasePair {
  input: string;
  expected: string;
}

// Bảng test là JSON: kiểm hình dạng trước để lỗi nhập bảng hiện rõ thay vì test pass nhầm.
function asPairs(table: unknown, name: string): CasePair[] {
  if (!Array.isArray(table)) throw new Error(`Bảng ${name} phải là mảng`);
  return table.map((row: unknown, index) => {
    const r = row as Partial<CasePair> | null;
    if (typeof r?.input !== 'string' || typeof r.expected !== 'string') {
      throw new Error(`Bảng ${name}, dòng ${index}: thiếu input/expected dạng chuỗi`);
    }
    return { input: r.input, expected: r.expected };
  });
}

const canonical = asPairs(canonicalCases, 'to-canonical');
const spoken = asPairs(spokenCases, 'to-spoken');
const machine = asPairs(machineCases, 'to-machine');
const roundTrip: string[] = roundTripCases;

describe('bảng case vi-math-normalizer', () => {
  it('có ít nhất 200 cặp test', () => {
    const total = canonical.length + spoken.length + machine.length + roundTrip.length;
    expect(total).toBeGreaterThanOrEqual(200);
  });

  it('không có input trùng trong cùng một bảng', () => {
    for (const table of [canonical, spoken, machine]) {
      const inputs = table.map((c) => c.input);
      expect(new Set(inputs).size).toBe(inputs.length);
    }
    expect(new Set(roundTrip).size).toBe(roundTrip.length);
  });
});

describe('toCanonical', () => {
  it.each(canonical)('"$input" → "$expected"', ({ input, expected }) => {
    expect(toCanonical(input)).toBe(expected);
  });

  it('idempotent trên mọi kết quả', () => {
    for (const { expected } of canonical) expect(toCanonical(expected)).toBe(expected);
  });
});

describe('toSpoken', () => {
  it.each(spoken)('"$input" → "$expected"', ({ input, expected }) => {
    expect(toSpoken(input)).toBe(expected);
  });

  it('lời đọc không còn chữ số hay dấu thập phân', () => {
    for (const { input } of spoken) {
      if (/[,.]\d/.test(input)) expect(toSpoken(input)).not.toMatch(/\d[,.]\d/);
    }
  });
});

describe('toMachine', () => {
  it.each(machine)('"$input" → "$expected"', ({ input, expected }) => {
    expect(toMachine(input)).toBe(expected);
  });
});

describe('round-trip toCanonical(toSpoken(x)) === x', () => {
  it.each(roundTrip)('"%s"', (x) => {
    expect(toCanonical(toSpoken(x))).toBe(x);
  });

  it('mọi case số của bảng toSpoken (trừ chữ số đứng một mình) cũng round-trip', () => {
    // Chữ số đứng một mình ("năm", "không") cố ý không đổi về số ở toCanonical (dễ là chữ thường).
    const numeric = spoken
      .map((c) => c.input)
      .filter((x) => /^\d+(?:,\d+)?(?:\/\d+)?%?$/.test(x) && !/^\d$/.test(x));
    expect(numeric.length).toBeGreaterThan(50);
    for (const x of numeric) expect(toCanonical(toSpoken(x))).toBe(x);
  });
});
