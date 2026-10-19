import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Quy tắc cứng 12: Prisma chỉ được import trong src/server/dal/**.
const prismaMessage = 'Chỉ src/server/dal/** được dùng Prisma (quy tắc cứng 12).';
const prismaImportRestriction = {
  paths: [
    { name: '@prisma/client', message: prismaMessage },
    { name: '@prisma/adapter-pg', message: prismaMessage },
    { name: '@/server/dal/client', message: prismaMessage },
  ],
  patterns: [
    { group: ['**/dal/generated', '**/dal/generated/**', '**/dal/client', '@prisma/client/*'], message: prismaMessage },
  ],
};

// Code chạy ở client (components, lib dùng chung) không bao giờ import src/server.
const clientImportRestriction = {
  ...prismaImportRestriction,
  patterns: [
    ...prismaImportRestriction.patterns,
    { group: ['@/server', '@/server/**', '**/server/**'], message: 'Code client không được import src/server.' },
  ],
};

// Actor `system` chỉ được tạo trong worker, seed và scripts (phase 04).
const systemActorRestriction = {
  name: '@worker/actor',
  message: 'Actor system chỉ được tạo trong worker/**, prisma/seed.ts, scripts/**.',
};

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
      'next-env.d.ts',
      'src/server/dal/generated/**',
      'services/**',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        { ...prismaImportRestriction, paths: [...prismaImportRestriction.paths, systemActorRestriction] },
      ],
    },
  },
  {
    files: ['src/components/**', 'src/lib/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { ...clientImportRestriction, paths: [...clientImportRestriction.paths, systemActorRestriction] },
      ],
    },
  },
  {
    files: ['src/server/dal/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [systemActorRestriction] }] },
  },
  {
    files: ['worker/**', 'prisma/seed.ts', 'scripts/**', 'tests/**', '**/*.test.ts', 'eval/**'],
    rules: { 'no-restricted-imports': ['error', prismaImportRestriction] },
  },
];

export default config;
