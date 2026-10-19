import 'dotenv/config';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { hashSecret, passwordProblem } from '@/server/auth/password';
import { createAdminAccount } from '@/server/dal/users-dal';
import { systemActor } from '../worker/actor';

// Tạo tài khoản admin đầu tiên từ CLI trên PC (không có trang đăng ký, quy tắc cứng 11).
// Dùng: pnpm admin:create   (hỏi tên, email, mật khẩu; hoặc đặt CU_ADMIN_NAME/EMAIL/PASSWORD)
async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (env: string, question: string) => process.env[env] ?? (await rl.question(question));
  const name = (await ask('CU_ADMIN_NAME', 'Tên admin: ')).trim();
  const email = (await ask('CU_ADMIN_EMAIL', 'Email: ')).trim();
  const password = await ask('CU_ADMIN_PASSWORD', 'Mật khẩu (≥ 10 ký tự): ');
  rl.close();

  const problem = passwordProblem(password);
  if (!name || !email.includes('@') || problem) {
    console.error(problem ?? 'Tên và email không hợp lệ');
    process.exit(1);
  }
  const id = await createAdminAccount(systemActor('create-first-admin'), {
    name,
    email,
    passwordHash: await hashSecret(password),
  });
  console.log(`Đã tạo admin ${email} (${id}). Đăng nhập tại https://<tên-pc>.<tailnet>.ts.net/admin/login`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
