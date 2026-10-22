import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetTestRedis } from '../../../../tests/helpers/auth-test-world';
import { withStudentStartLock } from './student-start-lock';

// Khoá mở phiên (Redis thật): cùng học sinh thì chạy lần lượt, khác học sinh thì song song; lỗi vẫn nhả khoá.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(resetTestRedis);

describe('withStudentStartLock', () => {
  it('hai lần mở cùng lúc của một học sinh chạy lần lượt: lần sau thấy kết quả của lần trước', async () => {
    const studentId = randomUUID();
    let open: string | null = null;
    const created: string[] = [];
    // Mô phỏng startOrResumeSession: chưa có phiên mở thì tạo (có độ trễ như truy vấn DB).
    const startOrResume = () =>
      withStudentStartLock(studentId, async () => {
        if (open) return open;
        await sleep(50);
        open = randomUUID();
        created.push(open);
        return open;
      });
    const [a, b] = await Promise.all([startOrResume(), startOrResume()]);
    expect(created).toHaveLength(1);
    expect(a).toBe(b);
  });

  it('học sinh khác nhau không chờ nhau', async () => {
    const order: string[] = [];
    await Promise.all([
      withStudentStartLock(randomUUID(), async () => {
        await sleep(80);
        order.push('chậm');
      }),
      withStudentStartLock(randomUUID(), async () => {
        order.push('nhanh');
      }),
    ]);
    expect(order).toEqual(['nhanh', 'chậm']);
  });

  it('hàm lỗi vẫn nhả khoá cho lần sau', async () => {
    const studentId = randomUUID();
    await expect(withStudentStartLock(studentId, async () => Promise.reject(new Error('db lỗi')))).rejects.toThrow('db lỗi');
    const started = Date.now();
    await withStudentStartLock(studentId, async () => undefined);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('khoá bị giữ quá thời gian chờ → vẫn chạy (không treo con ở màn hình tải)', async () => {
    const studentId = randomUUID();
    let release!: () => void;
    const holder = withStudentStartLock(studentId, () => new Promise<void>((r) => (release = r)));
    await sleep(20);
    expect(await withStudentStartLock(studentId, async () => 'chạy', 300)).toBe('chạy');
    release();
    await holder;
  });
});
