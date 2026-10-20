import { describe, expect, it } from 'vitest';
import {
  countWords,
  detectFrustration,
  detectGuessing,
  findFrustrationPhrase,
  noProgressStreak,
  normalizeVietnameseText,
  soundsUnsure,
  type AnswerAttempt,
} from './signals';
import { FRUSTRATION_PHRASES } from './frustration-phrases';

const marks = (...xs: boolean[]) => xs.map((madeProgress) => ({ madeProgress }));

describe('noProgressStreak', () => {
  it('mảng rỗng → 0', () => {
    expect(noProgressStreak([])).toBe(0);
  });

  it('đếm các lượt không tiến triển liên tiếp ở cuối', () => {
    expect(noProgressStreak(marks(false, true, false, false))).toBe(2);
    expect(noProgressStreak(marks(false, false, false))).toBe(3);
  });

  it('lượt cuối có tiến triển → 0', () => {
    expect(noProgressStreak(marks(false, false, true))).toBe(0);
  });
});

describe('normalizeVietnameseText', () => {
  it('NFD → NFC, chữ thường, gộp khoảng trắng', () => {
    const nfd = 'KHÓ  QUÁ\n'; // "KHÓ  QUÁ" dạng tổ hợp
    expect(normalizeVietnameseText(nfd)).toBe('khó quá');
    expect(normalizeVietnameseText(nfd)).toBe('khó quá'.normalize('NFC'));
  });
});

describe('findFrustrationPhrase', () => {
  it('khớp các cụm từ cơ bản của con lớp 5', () => {
    expect(findFrustrationPhrase('Con không biết')).toBe('con không biết');
    expect(findFrustrationPhrase('khó quá Mít ơi')).toBe('khó quá');
    expect(findFrustrationPhrase('chán')).toBe('chán');
    expect(findFrustrationPhrase('thôi, con không làm nữa')).toBe('không làm nữa');
    expect(findFrustrationPhrase('con mệt')).toBe('mệt');
    expect(findFrustrationPhrase('thôi con không học nữa')).toBe('không học nữa');
    expect(findFrustrationPhrase('Con thôi')).toBe('con thôi');
  });

  it('"thôi" đứng một mình hoặc trong câu bình thường không tính là nản', () => {
    expect(findFrustrationPhrase('Thôi')).toBeNull();
    expect(findFrustrationPhrase('thôi được, để con thử')).toBeNull();
    expect(findFrustrationPhrase('con nghĩ vậy thôi')).toBeNull();
  });

  it('trả cụm cụ thể nhất (dài nhất) khi nhiều cụm cùng khớp', () => {
    expect(findFrustrationPhrase('chán quá')).toBe('chán quá');
  });

  it('chữ hoa và dạng tổ hợp NFD vẫn khớp', () => {
    expect(findFrustrationPhrase('CHÁN QUÁ')).toBe('chán quá');
    expect(findFrustrationPhrase('chán')).toBe('chán');
    expect(findFrustrationPhrase('mệt')).toBe('mệt'); // dấu nặng + mũ theo thứ tự lạ
  });

  it('ranh giới từ Unicode: không khớp trong từ khác có dấu', () => {
    expect(findFrustrationPhrase('chánh văn phòng')).toBeNull();
    expect(findFrustrationPhrase('chánh')).toBeNull();
    expect(findFrustrationPhrase('mệtmỏi')).toBeNull();
    expect(findFrustrationPhrase('thôii')).toBeNull();
    expect(findFrustrationPhrase('đáp án là chán5')).toBeNull();
  });

  it('không nhầm chữ khác dấu', () => {
    expect(findFrustrationPhrase('chặn')).toBeNull();
    expect(findFrustrationPhrase('chàn')).toBeNull();
    expect(findFrustrationPhrase('thời gian')).toBeNull();
    expect(findFrustrationPhrase('mét vuông')).toBeNull();
  });

  it('dấu câu là ranh giới hợp lệ', () => {
    expect(findFrustrationPhrase('chán!')).toBe('chán');
    expect(findFrustrationPhrase('"khó quá"...')).toBe('khó quá');
  });

  it('biến thể không dấu nhiều âm tiết', () => {
    expect(findFrustrationPhrase('khong biet')).toBe('khong biet');
    expect(findFrustrationPhrase('kho qua')).toBe('kho qua');
  });

  it('câu bình thường, đề toán có "bỏ đi" không khớp', () => {
    expect(findFrustrationPhrase('Con nghĩ là 12 quả cam')).toBeNull();
    expect(findFrustrationPhrase('bỏ đi 3 quả thì còn 9 quả')).toBeNull();
    expect(findFrustrationPhrase('')).toBeNull();
    expect(findFrustrationPhrase('   ')).toBeNull();
  });

  it('mọi cụm trong danh sách đều tự khớp chính nó', () => {
    for (const p of FRUSTRATION_PHRASES) {
      expect(findFrustrationPhrase(p)).not.toBeNull();
    }
  });
});

describe('countWords', () => {
  it('bỏ token chỉ có dấu câu', () => {
    expect(countWords('  ừ  . ')).toBe(1);
    expect(countWords('con nghĩ là 12')).toBe(4);
    expect(countWords('')).toBe(0);
  });
});

describe('detectFrustration', () => {
  it('cụm từ nản → rule phrase', () => {
    expect(detectFrustration('Khó quá', [])).toEqual({ frustrated: true, rule: 'phrase', phrase: 'khó quá' });
  });

  it('câu ≤ 2 từ lặp lại y nguyên câu trước → short_repeat', () => {
    expect(detectFrustration('ừ', ['ừ'])).toEqual({ frustrated: true, rule: 'short_repeat' });
    expect(detectFrustration('Không ạ.', ['không ạ'])).toEqual({ frustrated: true, rule: 'short_repeat' });
    expect(detectFrustration('ừ', ['ừ'])).toMatchObject({ rule: 'short_repeat' }); // NFD "ừ"
    expect(detectFrustration('ù', ['ừ'])).toMatchObject({ frustrated: false }); // "ù" khác "ừ"
  });

  it('chỉ so với câu ngay trước', () => {
    expect(detectFrustration('ừ', ['ừ', 'con nghĩ là chia'])).toEqual({ frustrated: false, rule: null });
  });

  it('câu ngắn không lặp, hoặc lần đầu → không nản', () => {
    expect(detectFrustration('ừ', [])).toEqual({ frustrated: false, rule: null });
    expect(detectFrustration('được ạ', ['ừ'])).toEqual({ frustrated: false, rule: null });
  });

  it('câu 3 từ lặp lại không tính', () => {
    expect(detectFrustration('con chia đều', ['con chia đều'])).toEqual({ frustrated: false, rule: null });
  });

  it('đáp án số lặp lại không tính là nản', () => {
    expect(detectFrustration('12', ['12'])).toEqual({ frustrated: false, rule: null });
    expect(detectFrustration('0,45 m', ['0,45 m'])).toEqual({ frustrated: false, rule: null });
  });

  it('câu rỗng hoặc chỉ dấu câu → không nản', () => {
    expect(detectFrustration('', [''])).toEqual({ frustrated: false, rule: null });
    expect(detectFrustration('...', ['...'])).toEqual({ frustrated: false, rule: null });
  });
});

const att = (answer: string | null, responseTimeMs: number): AnswerAttempt => ({ answer, responseTimeMs });

describe('detectGuessing', () => {
  it('đổi đáp án 2 lần trong 3 lượt, đều < 3 giây → đoán bừa', () => {
    expect(detectGuessing([att('10', 1500), att('12', 1200), att('15', 900)])).toBe(true);
  });

  it('đổi qua lại cũng tính (A → B → A)', () => {
    expect(detectGuessing([att('10', 1000), att('12', 1000), att('10', 1000)])).toBe(true);
  });

  it('chỉ xét 3 lượt gần nhất', () => {
    expect(detectGuessing([att('1', 500), att('2', 500), att('3', 500), att('3', 500), att('3', 500)])).toBe(false);
  });

  it('một lần đổi chậm (≥ 3 giây) → không đủ 2 lần đổi nhanh', () => {
    expect(detectGuessing([att('10', 1000), att('12', 3000), att('15', 900)])).toBe(false);
  });

  it('chỉ 1 lần đổi → không', () => {
    expect(detectGuessing([att('10', 500), att('10', 500), att('15', 500)])).toBe(false);
  });

  it('ít hơn 3 lượt → không', () => {
    expect(detectGuessing([att('10', 500), att('12', 500)])).toBe(false);
    expect(detectGuessing([])).toBe(false);
  });

  it('đáp án chỉ khác hoa/thường hay khoảng trắng không tính là đổi', () => {
    expect(detectGuessing([att('mười', 500), att(' Mười ', 500), att('MƯỜI', 500)])).toBe(false);
  });

  it('lượt không có đáp án không tạo lần đổi', () => {
    expect(detectGuessing([att('10', 500), att(null, 500), att('12', 500)])).toBe(false);
  });

  it('thời gian không hợp lệ coi như không nhanh', () => {
    expect(detectGuessing([att('1', 500), att('2', Number.NaN), att('3', -5)])).toBe(false);
  });
});

describe('soundsUnsure', () => {
  it('con tự nói là đoán / chưa chắc', () => {
    expect(soundsUnsure('Tớ đoán thôi, là 0,3 hả Mít?')).toBe(true);
    expect(soundsUnsure('chắc là 4,36')).toBe(true);
    expect(soundsUnsure('Mình chưa chắc lắm')).toBe(true);
  });

  it('câu trả lời chắc chắn hoặc có lý do thì không', () => {
    expect(soundsUnsure('0,3 vì 3 phần mười đứng ngay sau dấu phẩy')).toBe(false);
    expect(soundsUnsure('Tớ chắc chắn là 0,5 lớn hơn')).toBe(false);
  });
});
