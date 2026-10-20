import { describe, expect, it } from 'vitest';
import { unitNameLeak } from './unit-name-leak';

// Câu thật của Mít / học sinh giả trong eval smoke.
describe('unitNameLeak', () => {
  it('nói sẵn lượng mới kèm tên hàng → lộ', () => {
    const msg = 'Đúng rồi, 7 phần trong 10 phần bằng nhau. Mỗi phần ấy gọi là một phần mười, vậy 7/10 là bao nhiêu phần mười?';
    expect(unitNameLeak(msg, 'Viết 7/10 và 45/100 thành số thập phân.', ['Lấy 7 phần. Mà rồi sao nữa?'])).toEqual(['một phần mười']);
  });

  it('gán tên đơn vị con chưa dùng → lộ', () => {
    const msg = 'Minh ơi, bạn thử viết hỗn số 3 7/100 dưới dạng số thập phân nhé, phần nguyên là 3 và phần phân số 7/100 là phần trăm.';
    expect(unitNameLeak(msg, 'Viết hỗn số 3 7/100 dưới dạng số thập phân.', [])).toEqual(['là phần trăm']);
  });

  it('đọc lại số có trong đề hoặc con đã nói → không lộ', () => {
    const problem = 'Viết 7/10 và 45/100 thành số thập phân.';
    expect(unitNameLeak('Vậy 45 phần trăm gồm mấy phần mười và mấy phần trăm?', problem, [])).toEqual([]);
    expect(unitNameLeak('Bạn nói 0,7 là 7 phần mười; vậy 7/100 đọc là mấy phần?', 'Viết hỗn số 3 7/100.', ['7 chia 10 là 0,7 á'])).toEqual([]);
    expect(unitNameLeak('Cả sợi ruy băng là 1 đoạn, bạn lấy 3 phần mười của nó. Vậy lớn hơn hay bé hơn cả sợi?', 'Mai cắt 10 đoạn, lấy 3 đoạn.', ['phân số 3/10'])).toEqual([]);
  });

  it('con đã nói chữ số ở hàng nào → nhắc lại không lộ', () => {
    const said = ['chữ số 4 đứng ngay sau dấu phẩy nên là hàng phần mười, còn số 5 đứng sau nữa nên là hàng phần trăm'];
    expect(unitNameLeak('Giờ bạn thử nói: 4 phần mười và 5 phần trăm ghép lại là bao nhiêu phần trăm?', 'Viết 45/100 thành số thập phân.', said)).toEqual([]);
  });

  it('câu hỏi không có lượng, câu hỏi lựa chọn → không lộ', () => {
    expect(unitNameLeak('Vậy 7/10 là bao nhiêu phần mười?', 'Viết 7/10.', [])).toEqual([]);
    expect(unitNameLeak('Chữ số đầu tiên sau dấu phẩy là phần mười hay phần trăm?', 'Viết 7/10.', [])).toEqual([]);
    expect(unitNameLeak('Hàng phần mười đứng ở đâu?', 'Viết 7/10.', [])).toEqual([]);
  });
});
