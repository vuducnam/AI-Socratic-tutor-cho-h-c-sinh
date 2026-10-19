'use client';

// Bàn phím toán cho tablet: chèn ký hiệu lớp 5 vào ô nhập (dấu phẩy thập phân, × và : theo SGK).
// Xếp kiểu bàn phím số: 7 8 9 | 4 5 6 | 1 2 3 | 0, kèm phép tính và so sánh ở cột phải.
const key = (label: string, insert: string, aria: string) => ({ label, insert, aria });
const KEYS: { label: string; insert: string; aria: string }[] = [
  key('7', '7', '7'), key('8', '8', '8'), key('9', '9', '9'), key('+', ' + ', 'cộng'), key('−', ' − ', 'trừ'),
  key('4', '4', '4'), key('5', '5', '5'), key('6', '6', '6'), key('×', ' × ', 'nhân'), key(':', ' : ', 'chia'),
  key('1', '1', '1'), key('2', '2', '2'), key('3', '3', '3'), key('=', ' = ', 'bằng'), key(',', ',', 'dấu phẩy'),
  key('0', '0', '0'), key('<', ' < ', 'bé hơn'), key('>', ' > ', 'lớn hơn'), key('%', '%', 'phần trăm'), key('/', '/', 'phần (phân số)'),
];

export function MathKeyboard({ onInsert, onBackspace }: { onInsert: (text: string) => void; onBackspace: () => void }) {
  return (
    <div className="math-keyboard" role="group" aria-label="Bàn phím toán">
      {KEYS.map((k) => (
        <button key={k.label} type="button" aria-label={k.aria} onClick={() => onInsert(k.insert)}>
          {k.label}
        </button>
      ))}
      <button type="button" aria-label="xoá một ký tự" className="key-wide" onClick={onBackspace}>
        ⌫
      </button>
    </div>
  );
}
