import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { mintActor } from '@/server/dal/mint-actor';
import { createFlag } from '@/server/dal/flags-dal';
import { createAdminWorld } from '../../tests/helpers/auth-test-world';
import { closeTestDatabases } from '../../tests/helpers/test-database';
import { runNotifyParents } from './notify-parents';

// Cờ PAUSE an toàn và khoá PIN → email tới phụ huynh liên kết (SMTP giả lập cục bộ). Email không chứa
// nội dung hội thoại, chỉ báo có việc cần xem + link /parent.

const received: { to: string[]; body: string }[] = [];
let server: SMTPServer;
const PORT = 2526;

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, session, done) {
      let body = '';
      stream.on('data', (c: Buffer) => (body += c.toString('utf8')));
      stream.on('end', () => {
        received.push({ to: session.envelope.rcptTo.map((r) => r.address), body });
        done();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  process.env.SMTP_URL = `smtp://127.0.0.1:${PORT}`;
  process.env.APP_BASE_URL = 'https://cu.example.test';
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeTestDatabases();
});

describe('runNotifyParents', () => {
  it('gửi email cho phụ huynh liên kết, không kèm nội dung hội thoại', async () => {
    const w = await createAdminWorld();
    const flagId = await createFlag(mintActor('system', '00000000-0000-0000-0000-000000000000'), {
      studentId: w.studentId,
      type: 'safety_pause',
      severity: 'high',
      detail: { code_signals: ['bị bắt nạt'] },
    });
    const result = await runNotifyParents({ flagId });
    expect(result.sent).toBe(1);
    const mail = received.find((m) => m.to.includes(w.parentEmail));
    expect(mail).toBeDefined();
    expect(mail!.body).toContain('https://cu.example.test/parent');
    expect(mail!.body).not.toContain('bắt nạt');
  });
});
