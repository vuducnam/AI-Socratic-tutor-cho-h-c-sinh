import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Quy tắc cứng 12: Prisma chỉ được import trong src/server/dal/**.
const prismaMessage = 'Chỉ src/server/dal/** được dùng Prisma (quy tắc cứng 12).';
const prismaPaths = [
  { name: '@prisma/client', message: prismaMessage },
  { name: '@prisma/adapter-pg', message: prismaMessage },
  { name: '@/server/dal/client', message: prismaMessage },
];
const prismaPatterns = [
  { group: ['**/dal/generated', '**/dal/generated/**', '**/dal/client', '@prisma/client/*'], message: prismaMessage },
];

// Actor branded chỉ được tạo ở src/server/auth/session.ts (phiên đã xác thực) và worker/actor.ts (system).
const mintActorPatterns = [
  {
    group: ['**/mint-actor', '@/server/dal/mint-actor'],
    message: 'Actor chỉ được tạo trong src/server/auth/session.ts hoặc worker/actor.ts.',
  },
];
// Actor `system` chỉ dùng trong worker/**, prisma/seed.ts, scripts/** (và test, eval).
const systemActorPatterns = [
  {
    group: ['@worker/actor', '**/worker/actor'],
    message: 'Actor system chỉ được dùng trong worker/**, prisma/seed.ts, scripts/**.',
  },
];
// Code chạy ở client (components, lib dùng chung) không bao giờ import src/server.
const serverPatterns = [
  { group: ['@/server', '@/server/**', '**/server/**'], message: 'Code client không được import src/server.' },
];

const restrict = (paths, patterns) => ['error', { paths, patterns }];

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'storage/**',
      'next-env.d.ts',
      'src/server/dal/generated/**',
      'services/**',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': restrict(prismaPaths, [...prismaPatterns, ...mintActorPatterns, ...systemActorPatterns]),
    },
  },
  {
    files: ['src/components/**', 'src/lib/**'],
    rules: {
      'no-restricted-imports': restrict(prismaPaths, [
        ...prismaPatterns,
        ...mintActorPatterns,
        ...systemActorPatterns,
        ...serverPatterns,
      ]),
    },
  },
  {
    files: ['src/server/dal/**'],
    rules: {
      'no-restricted-imports': restrict(
        [],
        [
          ...systemActorPatterns,
          // DAL là tầng dưới cùng: không gọi ngược tầng voice (file, mạng). Hợp đồng dùng chung đặt ở src/server/storage.
          { group: ['@/server/voice', '@/server/voice/**', '**/server/voice/**'], message: 'DAL không import tầng voice.' },
        ],
      ),
    },
  },
  {
    files: ['src/server/dal/mint-actor.ts', 'src/server/auth/session.ts'],
    rules: { 'no-restricted-imports': restrict(prismaPaths, [...prismaPatterns, ...systemActorPatterns]) },
  },
  {
    files: ['worker/**', 'prisma/seed.ts', 'scripts/**', 'eval/**'],
    rules: { 'no-restricted-imports': restrict(prismaPaths, [...prismaPatterns, ...mintActorPatterns]) },
  },
  {
    // worker/actor.ts là nơi duy nhất ngoài session.ts tạo actor.
    files: ['worker/actor.ts', 'tests/**', '**/*.test.ts'],
    rules: { 'no-restricted-imports': restrict(prismaPaths, [...prismaPatterns]) },
  },
];

export default config;
