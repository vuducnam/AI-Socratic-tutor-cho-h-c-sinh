import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Migration chạy bằng role cu_owner (sở hữu bảng và purge_student); app/worker dùng cu_app.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_OWNER_URL'),
  },
});
