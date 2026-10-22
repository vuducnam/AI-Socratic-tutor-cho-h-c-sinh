import { describe, expect, it } from 'vitest';
import { renderPrompt } from '@/server/llm/prompt-loader';
import { extractPromptVariables } from './prompt-variable-extractor';

const MARK = '<!-- CUT -->';
const template = 'Gọi em là "{name}". Tối đa {n} câu.\nĐề: {problem}\nJSON {"message": "..."} tối đa {n} câu\n<!-- CUT -->\n- state: {state}';

describe('extractPromptVariables', () => {
  it('lấy lại đúng giá trị biến, kể cả biến lặp lại và giá trị nhiều dòng', () => {
    const vars = { name: 'Minh', n: 2, problem: 'So sánh 0,45 và 0,5.\nĐiền dấu.', state: 'PROBE' };
    const [a, b] = renderPrompt(template, vars).split(MARK);
    expect(extractPromptVariables(template, [a!.trim(), b!.trim()], MARK)).toEqual({ name: 'Minh', n: '2', problem: 'So sánh 0,45 và 0,5.\nĐiền dấu.', state: 'PROBE' });
  });

  it('bản render không khớp template → null', () => {
    expect(extractPromptVariables(template, ['khác hẳn', '- state: X'], MARK)).toBeNull();
  });

  it('biến lặp lại mà hai chỗ khác giá trị → null', () => {
    const blocks = ['Gọi em là "Minh". Tối đa 2 câu.\nĐề: x\nJSON {"message": "..."} tối đa 3 câu', '- state: P'];
    expect(extractPromptVariables(template, blocks, MARK)).toBeNull();
  });
});
