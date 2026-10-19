import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migration chạy bằng role cu_owner (sở hữu bảng và purge_student); app/worker dùng cu_app.
// `prisma generate` (postinstall, build Docker, CI lint) không cần DB nên dùng URL giữ chỗ khi chưa đặt;
// lệnh migrate thật sẽ báo lỗi kết nối rõ ràng nếu thiếu DATABASE_OWNER_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --conditions=react-server prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_OWNER_URL ?? 'postgresql://unset:unset@localhost:5432/unset',
  },
});
