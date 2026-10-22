import { describe, expect, it } from 'vitest';
import { groundedLeakWords } from './grounded-leak-words';

// Các ca lấy từ eval Lịch sử và Địa lí: gợi bằng chữ của ý chính là lộ; câu chỉ hỏi loại điều cần tìm thì không.

const NGO_QUYEN = 'Ngô Quyền cho đóng cọc nhọn bịt sắt dưới sông, nhử giặc vào lúc triều lên; triều xuống, thuyền giặc va cọc vỡ đắm.';
const NGO_QUYEN_Q = 'Ngô Quyền đã dùng cách gì để đánh tan thuyền giặc trên sông?';
const GIOT = 'Chiều 13 – 3 – 1954 ở Him Lam, Phan Đình Giót bị thương vẫn lao vào bịt lỗ châu mai, giúp đơn vị diệt cứ điểm.';
const GIOT_Q = 'Em có suy nghĩ gì về anh hùng Phan Đình Giót?';
const VAN_LANG = 'Nghề chính của cư dân Văn Lang, Âu Lạc là làm ruộng trồng lúa; họ còn trồng dâu, nuôi tằm, dệt vải.';
const VAN_LANG_Q = 'Cư dân Văn Lang, Âu Lạc sống bằng những nghề gì?';

const check = (message: string, quote: string, statement: string, problemText: string, said: string[] = []) =>
  groundedLeakWords({ quotes: [quote], message, statements: [statement], said, problemText });

describe('groundedLeakWords', () => {
  it('gợi bằng chữ của ý chính con chưa nói: công nhận là lộ', () => {
    const m1 = 'Theo sách, Ngô Quyền cho cắm thứ gì dưới lòng sông để chờ thuyền giặc?';
    expect(check(m1, 'cắm thứ gì dưới lòng sông', NGO_QUYEN, NGO_QUYEN_Q)).toEqual(['dưới']);
    const m2 = 'Bạn mở lại câu chuyện về anh, anh ấy đã làm việc gì đặc biệt khi đang bị thương?';
    expect(check(m2, 'khi đang bị thương', GIOT, GIOT_Q)).toEqual(['thương']);
    const m3 = 'Nhìn lại trang 26, bạn thấy điều gì nữa liên quan tới vải không?';
    expect(check(m3, 'liên quan tới vải', VAN_LANG, VAN_LANG_Q)).toEqual(['vải']);
  });

  it('câu chỉ hỏi loại điều cần tìm, hay chữ có trong đề: không phải lộ bằng chữ', () => {
    const m = 'Trước khi thuyền giặc tới, Ngô Quyền đã cho quân chuẩn bị gì?';
    expect(check(m, 'đã cho quân chuẩn bị gì', NGO_QUYEN, NGO_QUYEN_Q)).toEqual([]);
    expect(check('Rìu và trống đồng được làm bằng gì?', 'làm bằng gì', VAN_LANG, VAN_LANG_Q)).toEqual([]);
    expect(check('Sách kể nước sông thế nào khi quân giặc vào?', 'nước sông thế nào khi quân giặc vào', 'Hoằng Tháo đem quân xâm lược nước ta.', NGO_QUYEN_Q)).toEqual([]);
    expect(check('Ngô Quyền chờ thuyền giặc vào lúc nào?', 'chờ thuyền giặc vào lúc nào', NGO_QUYEN, NGO_QUYEN_Q)).toEqual([]);
  });

  it('chữ con đã nói thì Mít nhắc lại được; lời trích không có trong tin của Mít thì không tính', () => {
    const m = 'Bạn nhớ ra việc đóng cọc rồi. Vì sao Ngô Quyền làm việc đó?';
    expect(check(m, 'đóng cọc', NGO_QUYEN, NGO_QUYEN_Q, ['Hình như ông cho đóng cọc'])).toEqual([]);
    expect(check('Bạn mở SGK trang 39 nhé?', 'cọc nhọn', NGO_QUYEN, NGO_QUYEN_Q)).toEqual([]);
  });

  it('giữ dấu thanh, chỉ thống nhất vị trí dấu: "thuỷ" khớp "thủy", nhưng "thường" không khớp "thương"', () => {
    expect(check('Bạn có thường xem tranh không?', 'thường', 'Phan Đình Giót bị thương vẫn lao vào.', 'Em nghĩ gì về anh Giót?')).toEqual([]);
    expect(check('Thuỷ triều lúc đó thế nào?', 'thuỷ triều', 'Ngô Quyền lợi dụng thủy triều.', NGO_QUYEN_Q)).toEqual(['thủy', 'triều']);
  });
});
