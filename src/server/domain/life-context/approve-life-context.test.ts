import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR_ID } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';
import { seedLifeContexts } from '@/server/dal/seed/seed-life-contexts';
import { createAdminWorld } from '../../../../tests/helpers/auth-test-world';
import { ensureFakeCurriculum } from '../../../../tests/helpers/fake-curriculum-world';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import { approveLifeContext } from './approve-life-context';
import { LifeContextSeedError, lifeContextContentHash, parseLifeContextFile } from './life-context-schema';

// Duyệt đi theo dữ liệu: màn hình Duyệt ghi approved {by, at, content_hash} vào YAML; seed ở DB khác mang
// theo; sửa mẫu sau khi duyệt thì mất duyệt.

const YAML = `# Fixture (không phải dữ liệu thật)
subject: fx-math
grade: 5
contexts:
  - id: FX.CTX.APPROVE
    skill_id: FX.DEC.ADD
    theme: home
    min_grade: 5
    max_grade: 5
    template:
      setup: "Nhà Lan có {a} và {b} nước."
      real_question: "Có tất cả bao nhiêu lít nước?"
      variables:
        a: { min: 1.5, max: 2.5, step: 0.5, unit: "l" }
        b: { min: 0.5, max: 1, step: 0.5, unit: "l" }
      answer_expression: "a + b"
    safety: { adult_required: false, notes: "" }
`;
const system = mintActor('system', SYSTEM_ACTOR_ID);
const known = new Set(['FX.DEC.ADD']);
let dir: string;
let file: string;

beforeAll(async () => {
  await ensureFakeCurriculum();
  dir = mkdtempSync(join(tmpdir(), 'cu-life-'));
  file = join(dir, 'grade5.yaml');
  writeFileSync(file, YAML);
  process.env.LIFE_CONTEXTS_DIR = dir;
});
afterAll(async () => {
  delete process.env.LIFE_CONTEXTS_DIR;
  await closeTestDatabases();
});

describe('duyệt tình huống', () => {
  it('chưa duyệt → seed với approved_by null; duyệt → YAML có approved khớp hash; seed lại vẫn đã duyệt', async () => {
    const w = await createAdminWorld();
    let contexts = parseLifeContextFile(file, readFileSync(file, 'utf8'), known);
    await seedLifeContexts(system, contexts);
    const before = await appDb().query(`SELECT approved_by, content_hash FROM life_contexts WHERE id = 'FX.CTX.APPROVE'`);
    expect(before.rows[0].approved_by).toBeNull();

    await approveLifeContext(mintActor('parent', w.parentId), { id: 'FX.CTX.APPROVE', contentHash: before.rows[0].content_hash, today: '2026-10-19' });
    const text = readFileSync(file, 'utf8');
    expect(text).toContain(`by: ${w.parentEmail}`);
    expect(text).toContain('# Fixture');

    contexts = parseLifeContextFile(file, text, known);
    expect(contexts[0]!.approved?.content_hash).toBe(lifeContextContentHash(contexts[0]!));
    const result = await seedLifeContexts(system, contexts);
    expect(result.approved).toBe(1);
    const after = await appDb().query(`SELECT approved_by FROM life_contexts WHERE id = 'FX.CTX.APPROVE'`);
    expect(after.rows[0].approved_by).toBe(w.parentId);
  });

  it('sửa mẫu sau khi duyệt → seed coi như chưa duyệt', async () => {
    const edited = readFileSync(file, 'utf8').replace('Có tất cả bao nhiêu lít nước?', 'Hai bình có tất cả bao nhiêu lít nước?');
    const result = await seedLifeContexts(system, parseLifeContextFile(file, edited, known));
    expect(result).toMatchObject({ approved: 0, staleApprovals: ['FX.CTX.APPROVE'] });
  });

  it('YAML có tên nhãn hàng hoặc việc nguy hiểm không có người lớn → seed từ chối', () => {
    const bad = YAML.replace('Nhà Lan có', 'Lan một mình ra đường mua Coca có').replace('FX.CTX.APPROVE', 'FX.CTX.BAD');
    expect(() => parseLifeContextFile('bad.yaml', bad, known)).toThrow(LifeContextSeedError);
  });
});
