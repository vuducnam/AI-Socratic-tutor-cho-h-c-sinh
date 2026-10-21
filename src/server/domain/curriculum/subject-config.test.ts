import { describe, expect, it } from 'vitest';
import { findSubject, loadSubjects, parseSubjectsYaml } from './subject-config';

// Danh sách môn đọc từ config/subjects.yaml; Toán kiểm bằng sympy, Lịch sử và Địa lí bằng ý chính.

describe('subject-config', () => {
  it('đọc config thật: có Toán và Lịch sử và Địa lí với đúng cách kiểm đáp án', () => {
    expect(loadSubjects().map((s) => s.id)).toEqual(['math', 'history_geography']);
    expect(findSubject('math')).toMatchObject({ verifier: 'sympy', math_keyboard: true });
    expect(findSubject('history_geography')).toMatchObject({ name: 'Lịch sử và Địa lí', verifier: 'key_facts', math_keyboard: false });
    expect(findSubject('physics')).toBeNull();
  });

  it('từ chối id trùng và verifier lạ', () => {
    const row = 'id: math\n    name: Toán\n    verifier: sympy\n    math_keyboard: true';
    expect(() => parseSubjectsYaml(`subjects:\n  - ${row}\n  - ${row}\n`)).toThrow();
    expect(() => parseSubjectsYaml('subjects:\n  - id: math\n    name: Toán\n    verifier: llm\n    math_keyboard: true\n')).toThrow();
  });
});
