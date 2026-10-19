import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

// Nơi duy nhất khởi tạo Prisma client (quy tắc cứng 12). App và worker kết nối bằng role cu_app.
const globalForPrisma = globalThis as unknown as { cuPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL chưa được đặt');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma: PrismaClient = globalForPrisma.cuPrisma ?? createClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.cuPrisma = prisma;
