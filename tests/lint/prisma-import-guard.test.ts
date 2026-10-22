import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Quy tắc cứng 12: import Prisma ngoài src/server/dal/** phải làm `pnpm lint` fail.
const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImportErrors(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
}

const serverComponent = (imp: string) => `${imp}\nexport default function Page() { return null; }\n`;

describe('lint chặn Prisma ngoài DAL', () => {
  it.each([
    ["import { PrismaClient } from '@prisma/client';", 'src/app/(parent)/parent/page.tsx'],
    ["import { prisma } from '@/server/dal/client';", 'src/app/(parent)/parent/page.tsx'],
    ["import { PrismaClient } from '../server/dal/generated/client';", 'src/app/page.tsx'],
    ["import { PrismaClient } from '@prisma/client';", 'src/server/domain/session/open-session.ts'],
    ["import { PrismaClient } from '@prisma/client';", 'worker/jobs/some-job.ts'],
  ])('%s trong %s → lỗi', async (imp, file) => {
    expect(await restrictedImportErrors(serverComponent(imp), file)).not.toHaveLength(0);
  });

  it('cho phép trong src/server/dal/**', async () => {
    const code = "import { PrismaClient } from '@prisma/client';\nexport const x = PrismaClient;\n";
    expect(await restrictedImportErrors(code, 'src/server/dal/students-dal.ts')).toHaveLength(0);
  });

  it('component client không được import src/server', async () => {
    const code = "'use client';\nimport { x } from '@/server/domain/foo';\nexport const y = x;\n";
    expect(await restrictedImportErrors(code, 'src/components/chat/chat-input.tsx')).not.toHaveLength(0);
  });
});
