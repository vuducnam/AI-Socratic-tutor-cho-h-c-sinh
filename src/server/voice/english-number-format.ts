import 'server-only';

// Whisper tiếng Anh viết số kiểu Anh ("0.45", "1,000"). Con học toán theo SGK Việt Nam: dấu phẩy là dấu thập phân,
// nghìn tách bằng khoảng trắng. Đổi trước khi chữ hiện trong ô nhập, để con không thấy "0.45" và Mít không phải
// nhắc dấu phẩy cho lỗi của máy (CLAUDE.md: không để 0.45 lọt ra UI học sinh).

/** "1,000" → "1 000"; "0.45" → "0,45". Chỉ dùng cho chữ STT tiếng Anh. */
export function toVietnameseNumberStyle(text: string): string {
  return text
    .replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,])/g, (m) => m.replaceAll(',', ' '))
    .replace(/(?<![\d.,])(\d+)\.(\d+)(?![\d.])/g, '$1,$2');
}
