import 'server-only';

// Cụm từ cho thấy con (lớp 5) đang nản (con xưng "con", hoặc "mình"/"tớ" vì Cú là bạn học) hoặc muốn bỏ cuộc. So khớp sau khi chuẩn hoá NFC + chữ thường,
// theo ranh giới từ Unicode (xem `signals.ts`), nên "chán" không khớp trong "chánh".
// Chỉ thêm cụm từ ít nhập nhằng: cụm từ đơn âm tiết ("chán", "mệt") giữ lại vì con hay nói cụt,
// nhưng không thêm cụm dễ trùng nghĩa khác: "chịu" một mình ("chịu khó"), "bỏ đi" (đề toán hay viết
// "bỏ đi 3 quả cam"), "thôi" một mình ("thôi được", "con nghĩ vậy thôi") — chỉ bắt "thôi" trong cụm rõ nghĩa.
// Một số biến thể không dấu nhiều âm tiết được giữ vì con có thể gõ phím không dấu; biến thể không dấu
// đơn âm tiết ("chan", "met") bị loại vì dễ trùng từ khác.
export const FRUSTRATION_PHRASES: readonly string[] = [
  'con không biết',
  'không biết',
  'con chịu',
  'mình chịu',
  'tớ chịu',
  'chịu thôi',
  'không hiểu',
  'khó quá',
  'khó lắm',
  'chán',
  'chán quá',
  'con thôi',
  'mình thôi',
  'tớ thôi',
  'thôi không học',
  'không học nữa',
  'không làm nữa',
  'không làm đâu',
  'không muốn học',
  'không muốn làm',
  'mệt',
  'mệt quá',
  'buồn ngủ',
  // Biến thể không dấu (gõ phím).
  'khong biet',
  'kho qua',
  'khong lam nua',
  'khong hoc nua',
  'chan qua',
  'met qua',
];
