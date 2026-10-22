import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import type { AuthorizationFixture, FixtureContext } from '@/server/dal/authorization-fixtures';
import { mintActor } from '@/server/dal/mint-actor';
import { seedStudentEverywhere } from '../helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../helpers/test-database';

// Quy tắc cứng 14, SPEC §3.3: mọi hàm DAL công khai, gọi bằng phụ huynh KHÔNG liên kết, bị từ chối.
// Danh sách hàm lấy bằng cách duyệt export của từng module DAL, nên hàm mới tự vào test; hàm thiếu
// fixture → fail.

const DAL_DIR = 'src/server/dal';
const NOT_DAL_MODULES = new Set(['client.ts', 'actor.ts', 'mint-actor.ts', 'authorization-fixtures.ts', 'role-guards.ts']);

const moduleFiles = readdirSync(DAL_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !NOT_DAL_MODULES.has(f));
const seedFiles = (existsSync(join(DAL_DIR, 'seed')) ? readdirSync(join(DAL_DIR, 'seed'), { withFileTypes: true }) : [])
  .filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.test.ts'))
  .map((d) => `seed/${d.name}`);

let ctx: FixtureContext;

beforeAll(async () => {
  process.env.ADMIN_ENABLED = 'true';
  const a = await seedStudentEverywhere(appDb());
  const b = await seedStudentEverywhere(appDb());
  ctx = {
    studentId: a.studentId,
    linkedParentId: a.parentId,
    otherStudentId: b.studentId,
    otherParentId: b.parentId,
    adminId: a.adminId,
    sessionId: a.sessionId,
  };
});
afterAll(closeTestDatabases);

function isPlainFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function' && !/^class\s/.test(Function.prototype.toString.call(value));
}

async function expectForbidden(promise: () => Promise<unknown>, label: string) {
  let error: unknown;
  try {
    await promise();
  } catch (err) {
    error = err;
  }
  expect(error instanceof AuthorizationError, `${label} phải bị từ chối, nhận được: ${String(error)}`).toBe(true);
}

async function expectNotForbidden(promise: () => Promise<unknown>, label: string) {
  try {
    await promise();
  } catch (err) {
    expect(err instanceof AuthorizationError, `${label} không được bị từ chối: ${String(err)}`).toBe(false);
  }
}

describe.each([...moduleFiles, ...seedFiles])('DAL %s', (file) => {
  it('mọi hàm export có fixture phân quyền, và fixture đúng hành vi', async () => {
    const mod = (await import(pathToFileURL(join(process.cwd(), DAL_DIR, file)).href)) as Record<string, unknown>;
    const fixtures = mod.authorizationFixtures as Record<string, AuthorizationFixture> | undefined;
    expect(fixtures, `${file} phải export authorizationFixtures`).toBeDefined();

    const functions = Object.entries(mod).filter(([, v]) => isPlainFunction(v)).map(([k]) => k);
    const missing = functions.filter((name) => !fixtures![name]);
    expect(missing, `${file}: hàm thiếu fixture`).toEqual([]);

    const strangerParent = mintActor('parent', ctx.otherParentId);
    const linkedParent = mintActor('parent', ctx.linkedParentId);
    const otherStudent = mintActor('student', ctx.otherStudentId);
    const admin = mintActor('admin', ctx.adminId);

    for (const name of functions) {
      const fixture = fixtures![name]!;
      const label = `${file}#${name}`;
      switch (fixture.kind) {
        case 'student-scoped':
          await expectForbidden(() => fixture.call(strangerParent, ctx), `${label} (phụ huynh không liên kết)`);
          await expectForbidden(() => fixture.call(otherStudent, ctx), `${label} (học sinh khác)`);
          if (fixture.linkedParentAllowed !== false) {
            await expectNotForbidden(() => fixture.call(linkedParent, ctx), `${label} (phụ huynh liên kết)`);
          }
          break;
        case 'admin-only':
          await expectForbidden(() => fixture.call(strangerParent, ctx), `${label} (phụ huynh)`);
          await expectForbidden(() => fixture.call(otherStudent, ctx), `${label} (học sinh)`);
          process.env.ADMIN_ENABLED = 'false';
          try {
            await expectForbidden(() => fixture.call(admin, ctx), `${label} (admin ở container app)`);
          } finally {
            process.env.ADMIN_ENABLED = 'true';
          }
          break;
        case 'system-only':
          await expectForbidden(() => fixture.call(strangerParent, ctx), `${label} (phụ huynh)`);
          await expectForbidden(() => fixture.call(admin, ctx), `${label} (admin)`);
          break;
        case 'self-account':
          await expectForbidden(() => fixture.call(otherStudent, ctx), `${label} (học sinh)`);
          break;
        case 'no-actor':
          expect(fixture.reason.trim().length, `${label}: cần lý do`).toBeGreaterThan(5);
          break;
      }
    }
  });
});
