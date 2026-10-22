import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

// Nơi duy nhất khởi tạo Prisma client (quy tắc cứng 12). App và worker kết nối bằng role cu_app.
// Khởi tạo lười ở lần dùng đầu: `next build` import module mà không có DB/DATABASE_URL.
const globalForPrisma = globalThis as unknown as { cuPrisma?: PrismaClient };

function client(): PrismaClient {
  if (globalForPrisma.cuPrisma) return globalForPrisma.cuPrisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL chưa được đặt');
  const created = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  globalForPrisma.cuPrisma = created;
  return created;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = client();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
