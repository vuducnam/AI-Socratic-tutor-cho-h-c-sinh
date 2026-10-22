import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR_ID } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';
import { seedKeyFacts } from '@/server/dal/seed/seed-key-facts';
import { createAdminWorld } from '../../../../tests/helpers/auth-test-world';
import { ensureFakeCurriculum } from '../../../../tests/helpers/fake-curriculum-world';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import { approveKeyFactsLesson, KeyFactsApprovalError } from './approve-key-facts';
import { parseKeyFactsFile } from './key-facts-yaml-schema';

// Duyệt ý chính theo bài (SPEC §5d): ghi approved {by, at, content_hash} vào YAML để seed ở DB khác mang theo;
// seed lại vẫn đã duyệt; sửa ý chính sau khi duyệt thì mất duyệt.

const YAML = `# Fixture (không phải dữ liệu thật)
subject: fx-math
grade: 5
lessons:
  - lesson_id: FX5.T1.B5
    objectives: ["So sánh hai số"]
    approved: null
    facts:
      - fact_id: FX5.T1.B5.F1
        statement: "Ý thứ nhất của bài."
        kind: feature
        accept: ["ý thứ nhất"]
        pages: "5"
        locator: "đoạn đầu"
`;
const system = mintActor('system', SYSTEM_ACTOR_ID);
const pages = new Map([['FX5.T1.B5', [5]]]);
let file: string;

beforeAll(async () => {
  await ensureFakeCurriculum();
  const dir = mkdtempSync(join(tmpdir(), 'cu-facts-'));
  file = join(dir, 'grade5.yaml');
  writeFileSync(file, YAML);
  process.env.KEY_FACTS_DIR = dir;
});
afterAll(async () => {
  delete process.env.KEY_FACTS_DIR;
  await closeTestDatabases();
});

describe('duyệt ý chính', () => {
  it('chưa duyệt → không dùng; duyệt → YAML và DB đã duyệt; seed lại vẫn đã duyệt; sửa thì mất duyệt', async () => {
    const w = await createAdminWorld();
    await seedKeyFacts(system, parseKeyFactsFile(file, readFileSync(file, 'utf8'), pages));
    const before = await appDb().query(`SELECT approved_by, content_hash FROM key_facts WHERE lesson_id = 'FX5.T1.B5'`);
    expect(before.rows).toEqual([{ approved_by: null, content_hash: expect.any(String) }]);

    // Hash cũ (trang mở từ trước khi sửa) → từ chối.
    await expect(approveKeyFactsLesson(mintActor('parent', w.parentId), { lessonId: 'FX5.T1.B5', contentHash: 'cu' })).rejects.toBeInstanceOf(KeyFactsApprovalError);

    await approveKeyFactsLesson(mintActor('parent', w.parentId), { lessonId: 'FX5.T1.B5', contentHash: before.rows[0].content_hash, today: '2026-10-21' });
    const yaml = readFileSync(file, 'utf8');
    expect(yaml).toContain(`content_hash: ${before.rows[0].content_hash}`);
    expect(yaml).toContain('at: 2026-10-21');
    const after = await appDb().query(`SELECT approved_by FROM key_facts WHERE lesson_id = 'FX5.T1.B5'`);
    expect(after.rows[0].approved_by).toBe(w.parentId);

    // Seed lại từ YAML: vẫn đã duyệt (người duyệt theo email trong YAML).
    const reseeded = await seedKeyFacts(system, parseKeyFactsFile(file, yaml, pages));
    expect(reseeded.approvedLessons).toBe(1);

    // Sửa ý chính sau khi duyệt → mất duyệt.
    const edited = yaml.replace('Ý thứ nhất của bài.', 'Ý đã sửa.');
    const stale = await seedKeyFacts(system, parseKeyFactsFile(file, edited, pages));
    expect(stale).toMatchObject({ approvedLessons: 0, staleApprovals: ['FX5.T1.B5'] });
  });

  it('học sinh không duyệt được', async () => {
    const w = await createAdminWorld();
    await expect(approveKeyFactsLesson(mintActor('student', w.studentId), { lessonId: 'FX5.T1.B5', contentHash: 'x' })).rejects.toThrow();
  });
});
