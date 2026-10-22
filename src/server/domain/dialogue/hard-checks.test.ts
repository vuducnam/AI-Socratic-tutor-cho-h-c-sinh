import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAcceptanceProblems } from '../../../../eval/load-acceptance-problems';
import { countQuestions, countWords, normalizeNumber, numbersIn, runHardChecks, splitSentences, type HardCheckContext } from './hard-checks';

// Fixture: 3 hội thoại golden (docs/DESIGN.md › Hội thoại mẫu) — lời Cú KHÔNG được bị chặn nhầm; và 30 đề
// nghiệm thu (nếu có trên máy) — chép lại đề không bị coi là lộ đáp án, nói thẳng đáp án thì bị chặn.

const COMPARE_PROBLEM = 'Số nào lớn hơn: 0,45 hay 0,5?';
const base = (over: Partial<HardCheckContext> = {}): HardCheckContext => ({
  maxSentences: 2,
  maxWords: 35,
  requiredQuestions: 1,
  maxQuestions: 1,
  problemText: COMPARE_PROBLEM,
  givenNumbers: ['0,45', '0,5'],
  forbiddenTerms: [],
  finalAnswer: { kind: 'relation', canonical: '>', expression: '0.5 > 0.45', choiceLabel: null },
  ...over,
});

const GOLDEN_MATH_TUTOR = [
  'Em chọn nhanh ghê! Em so sánh hai số này bằng cách nào?',
  'À, em so phần sau dấu phẩy. Thế 0,5 nghĩa là mấy phần mười?',
  'Đúng rồi. Còn 0,45 là bao nhiêu phần trăm của cái bánh?',
  '5 phần mười đổi ra phần trăm thì được bao nhiêu?',
  'Em tự tìm ra rồi đấy. Lúc nãy chỗ nào làm em nhầm nhỉ?',
];
const GOLDEN_ARGUE_TUTOR = [
  'Vì sao em chọn nộp cho cô?',
  'Có bạn lại nghĩ: nhặt được thì là của mình, vì không biết ai đánh rơi. Em nghĩ sao về ý đó?',
  'Em vừa dùng cách "đặt mình vào chỗ người khác" đấy. Nếu không ai đến nhận thì sao nhỉ?',
];
const GOLDEN_ANTI_CHEAT = 'Mít chỉ được giúp em tự tìm ra thôi. Mình làm bước đầu nhé: đề hỏi gì nào?';

describe('đếm câu, từ, câu hỏi', () => {
  it('dấu phẩy thập phân không tách câu', () => {
    expect(splitSentences('So sánh 0,45 và 0,5. Em thấy sao?')).toHaveLength(2);
    expect(countWords('Thế 0,5 nghĩa là mấy phần mười?')).toBe(7);
    expect(countQuestions('A? B?')).toBe(2);
  });
  it('số chuẩn hoá: 0,50 = 0.5; đọc bằng chữ cũng nhận ra', () => {
    expect(normalizeNumber('0,50')).toBe('0.5');
    expect(numbersIn('không phẩy năm và 0,45')).toEqual(['0.5', '0.45']);
  });
});

describe('hội thoại golden không bị chặn nhầm', () => {
  it.each(GOLDEN_MATH_TUTOR)('toán: %s', (line) => {
    expect(runHardChecks(line, base())).toMatchObject({ pass: true });
    expect(runHardChecks(line, base({ finalAnswer: { kind: 'number', canonical: '0.5', expression: 'max(0.45, 0.5)', choiceLabel: null } })).pass).toBe(true);
  });
  it.each([...GOLDEN_ARGUE_TUTOR, GOLDEN_ANTI_CHEAT])('argue / chống lách: %s', (line) => {
    expect(runHardChecks(line, base({ finalAnswer: null, problemText: 'Bạn Minh nhặt được 50.000 đồng ở sân trường.' })).pass).toBe(true);
  });
});

describe('LEAK theo kiểu đáp án', () => {
  it.each([
    'Đúng là 0,5 lớn hơn 0,45 nhé. Em hiểu chưa?',
    'Vậy số lớn hơn là 0,5. Em thấy đúng không?',
    '0,45 bé hơn 0,5 đó. Em giải thích lại nhé?',
    '0,5 > 0,45. Em có đồng ý không?',
    'Không phẩy năm lớn hơn không phẩy bốn mươi lăm. Em thấy sao?',
  ])('relation: chặn "%s"', (line) => {
    expect(runHardChecks(line, base()).reasons).toContain('LEAK');
  });

  it('relation: câu hỏi nhắc hai số không phải lộ đáp án', () => {
    expect(runHardChecks('0,5 và 0,45, số nào lớn hơn?', base()).reasons).not.toContain('LEAK');
  });

  it('number: đáp án không có trong đề → chặn, cả dạng chữ', () => {
    const ctx = base({
      problemText: 'Tính 4,5 + 0,45.',
      givenNumbers: ['4,5', '0,45'],
      finalAnswer: { kind: 'number', canonical: '4.95', expression: '4.5 + 0.45', choiceLabel: null },
    });
    expect(runHardChecks('Kết quả bằng 4,95 nhé. Em kiểm tra lại không?', ctx).reasons).toContain('LEAK');
    expect(runHardChecks('Bốn phẩy chín mươi lăm đúng không?', ctx).reasons).toContain('LEAK');
    // "5" nằm trong "4,5" của đề không bị báo nhầm; số 4,5 có sẵn trong đề.
    expect(runHardChecks('Em đặt 4,5 thẳng cột với 0,45 thế nào?', ctx).reasons).not.toContain('LEAK');
  });

  it('number: đáp án trùng một số có sẵn trong đề → không chặn bằng code (để Guard)', () => {
    const ctx = base({ finalAnswer: { kind: 'number', canonical: '0.5', expression: 'max(0.45, 0.5)', choiceLabel: null } });
    expect(runHardChecks('Em nhìn lại 0,5 nhé?', ctx).reasons).not.toContain('LEAK');
  });

  it('number_list: liệt kê đủ đáp án đúng thứ tự → chặn', () => {
    const ctx = base({
      problemText: 'Xếp 0,4; 0,325; 0,38; 0,3 theo thứ tự từ bé đến lớn.',
      givenNumbers: ['0,4', '0,325', '0,38', '0,3'],
      finalAnswer: { kind: 'number_list', canonical: ['0.3', '0.325', '0.38', '0.4'], expression: 'sort_asc(0.4, 0.325, 0.38, 0.3)', choiceLabel: null },
    });
    expect(runHardChecks('Thứ tự là 0,3; 0,325; 0,38; 0,4 nhé. Em thấy sao?', ctx).reasons).toContain('LEAK');
    expect(runHardChecks('Trong 0,4 và 0,3, số nào bé hơn?', ctx).reasons).not.toContain('LEAK');
  });

  it('choice: khẳng định lựa chọn đúng → chặn; hỏi thì không', () => {
    const ctx = base({ finalAnswer: { kind: 'choice', canonical: '1', expression: 'argmax(3.25, 3.4)', choiceLabel: 'Lan' } });
    expect(runHardChecks('Vậy bạn Lan nhảy xa nhất. Em đồng ý không?', ctx).reasons).toContain('LEAK');
    expect(runHardChecks('Bạn Lan nhảy được bao nhiêu mét?', ctx).reasons).not.toContain('LEAK');
  });
});

describe('LEAK bước trung gian', () => {
  const ribbon = 'Mai cắt sợi ruy băng thành 10 đoạn bằng nhau rồi lấy 3 đoạn. Phần Mai lấy viết bằng số thập phân là bao nhiêu?';
  const ctx = (over: Partial<HardCheckContext> = {}) =>
    base({
      problemText: ribbon,
      givenNumbers: ['10', '3'],
      finalAnswer: { kind: 'number', canonical: '0.3', expression: '3/10', choiceLabel: null },
      pendingStepResults: ['3/10', '0,3'],
      studentTexts: [],
      ...over,
    });

  it('nói sẵn kết quả bước con chưa làm → LEAK', () => {
    const r = runHardChecks('Phần Mai lấy là 3/10 sợi ruy băng. Vậy viết thành số thập phân thế nào?', ctx());
    expect(r.reasons).toContain('LEAK');
    expect(r.details.join()).toContain('3/10');
  });

  it('nhắc lại số con đã tự nói → không LEAK', () => {
    const r = runHardChecks('Bạn nói Mai lấy 3/10 sợi ruy băng rồi. Vậy viết thành số thập phân thế nào?', ctx({ studentTexts: ['Mai lấy 3/10 ạ'] }));
    expect(r.reasons).not.toContain('LEAK');
  });

  it('chữ số nằm sẵn trong số của đề không tính là kết quả bước', () => {
    const r = runHardChecks('Chữ số 4 và chữ số 5 của 0,45 đứng ở hàng nào?', base({ pendingStepResults: ['5 > 4'] }));
    expect(r.reasons).not.toContain('LEAK');
  });

  it('không có pendingStepResults (bước đã xong hoặc đã CONSOLIDATE) → không kiểm', () => {
    const r = runHardChecks('Phần Mai lấy là 3/10 sợi ruy băng. Bạn viết nó thành số thập phân thế nào?', ctx({ pendingStepResults: [] }));
    expect(r.reasons).not.toContain('LEAK');
  });
});

describe('LENGTH, SCOPE, FORMAT', () => {
  it('quá 2 câu, quá 35 từ, không có hoặc 2 câu hỏi → LENGTH', () => {
    expect(runHardChecks('Một. Hai. Ba?', base()).reasons).toContain('LENGTH');
    expect(runHardChecks(`${'từ '.repeat(36)}?`, base()).reasons).toContain('LENGTH');
    expect(runHardChecks('Em làm tiếp nhé.', base()).reasons).toContain('LENGTH');
    expect(runHardChecks('Em thấy sao? Em làm tiếp nhé?', base()).reasons).toContain('LENGTH');
  });
  it('lượt kết thúc không cần câu hỏi', () => {
    expect(runHardChecks('Hẹn em lần sau nhé!', base({ requiredQuestions: 0 })).pass).toBe(true);
  });
  it('thuật ngữ bị cấm → SCOPE', () => {
    const r = runHardChecks('Em dùng tỉ số phần trăm thử xem?', base({ forbiddenTerms: [{ term: 'tỉ số phần trăm', patterns: ['tỉ số phần trăm'] }] }));
    expect(r.reasons).toEqual(['SCOPE']);
  });
  it('số thập phân dấu chấm → FORMAT', () => {
    expect(runHardChecks('Em xem 0.45 nhé?', base()).reasons).toContain('FORMAT');
  });
});

const problemsAvailable = existsSync(process.env.EVAL_PROBLEMS_DIR ?? 'eval/problems');
describe.skipIf(!problemsAvailable)('30 đề nghiệm thu', () => {
  const problems = problemsAvailable ? loadAcceptanceProblems() : [];
  it.each(problems.map((p) => [p.id, p] as const))('%s: chép lại đề không bị chặn LEAK; nói thẳng đáp án thì bị chặn', (_id, p) => {
    const numeric = p.answer.machine.every((m) => /^-?\d+(\.\d+)?$/.test(m));
    if (!numeric) return;
    const ctx = base({
      problemText: p.text,
      givenNumbers: [],
      finalAnswer: { kind: p.answer.machine.length > 1 ? 'number_list' : 'number', canonical: p.answer.machine.length > 1 ? p.answer.machine : p.answer.machine[0]!, expression: '', choiceLabel: null },
    });
    expect(runHardChecks(p.text, ctx).reasons).not.toContain('LEAK');
    const inProblem = numbersIn(p.text);
    const answerInProblem = p.answer.machine.every((m) => inProblem.includes(normalizeNumber(m)));
    if (!answerInProblem && p.answer.machine.length === 1) {
      expect(runHardChecks(`Đáp án là ${p.answer.display}. Em thấy sao?`, ctx).reasons).toContain('LEAK');
    }
  });
});

describe('xác nhận khi con đang đoán', () => {
  // Câu thật trong eval: con đoán "0,5?" rồi "Hay là 0,3 đúng không?", Mít gật đầu.
  const msg = 'Đúng rồi, bạn đã tìm ra 0,3 rồi đó! Bạn viết thành 0,3 bằng cách nào?';
  const ctx = base({ finalAnswer: null, problemText: 'Mai cắt ruy băng 10 đoạn, lấy 3 đoạn.', givenNumbers: ['10', '3'] });

  it('đang đoán → "Đúng rồi" là lộ', () => {
    expect(runHardChecks(msg, { ...ctx, forbidConfirmation: true }).reasons).toContain('LEAK');
  });

  it('không đoán → được xác nhận; câu hỏi lại không có lời xác nhận → qua', () => {
    expect(runHardChecks(msg, ctx).pass).toBe(true);
    expect(runHardChecks('Bạn kể Mít nghe vì sao bạn chọn số đó nhé?', { ...ctx, forbidConfirmation: true }).pass).toBe(true);
  });
});
