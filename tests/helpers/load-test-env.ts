import { config } from 'dotenv';

// Test đọc .env.test (nếu có) rồi .env; biến đã đặt sẵn trong môi trường (CI) được giữ nguyên.
config({ path: '.env.test', quiet: true });
config({ quiet: true });
