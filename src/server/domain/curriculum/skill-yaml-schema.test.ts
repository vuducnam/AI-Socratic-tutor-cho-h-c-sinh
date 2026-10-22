import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { mintActor } from '@/server/dal/mint-actor';
import { seedSkills } from '@/server/dal/seed/seed-skills';
import { SYSTEM_ACTOR_ID } from '@/server/dal/actor';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import { parseSkillFile, SkillSeedError } from './skill-yaml-schema';

// SPEC §15.5: seed skill thiếu official_url → lỗi rõ ràng; misconception thiếu approved → lỗi.
const fixture = (name: string) => readFileSync(`tests/fixtures/skills/${name}`, 'utf8');
const system = mintActor('system', SYSTEM_ACTOR_ID);

afterAll(closeTestDatabases);

function seedError(name: string): SkillSeedError {
  try {
    parseSkillFile(name, fixture(name));
  } catch (err) {
    if (err instanceof SkillSeedError) return err;
    throw err;
  }
  throw new Error('phải lỗi');
}

describe('loader skill YAML', () => {
  it('thiếu source.official_url hoặc source.lesson → lỗi nêu tên file, skill_id, trường thiếu', () => {
    const err = seedError('missing-official-url.yaml');
    expect(err.problems.some((p) => p.includes('missing-official-url.yaml') && p.includes('FIXTURE.NO.URL') && p.includes('source.official_url'))).toBe(true);
    expect(err.problems.some((p) => p.includes('FIXTURE.NO.LESSON') && p.includes('source.lesson'))).toBe(true);
  });

  it('misconception thiếu approved → lỗi; URL bên thứ ba → lỗi', () => {
    const err = seedError('unapproved-misconception.yaml');
    expect(err.problems.some((p) => p.includes('FIXTURE.UNAPPROVED') && p.includes('approved'))).toBe(true);
    expect(err.problems.some((p) => p.includes('FIXTURE.THIRD_PARTY') && p.includes('taphuan'))).toBe(true);
  });

  it('seed hai lần không nhân đôi và giữ trạng thái duyệt; approved.by phải là user có thật', async () => {
    const email = `duyet-${randomUUID().slice(0, 8)}@test.local`;
    const { rows } = await appDb().query<{ id: string }>(
      `INSERT INTO users (role, name, email, password_hash) VALUES ('admin', 'Duyệt', $1, 'x') RETURNING id`,
      [email],
    );
    const skills = parseSkillFile('valid-skills.yaml', fixture('valid-skills.yaml').replace('__APPROVER__', email));
    await seedSkills(system, skills);
    await seedSkills(system, skills);
    const m = await appDb().query(
      `SELECT approved_by, count(*) OVER () AS n FROM misconceptions WHERE id = 'FIXTURE.DECIMAL.COMPARE.LONGER_IS_BIGGER'`,
    );
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].approved_by).toBe(rows[0]!.id);

    const unknown = parseSkillFile('valid-skills.yaml', fixture('valid-skills.yaml').replace('__APPROVER__', 'nobody@nowhere.test'));
    await expect(seedSkills(system, unknown)).rejects.toThrow(/không phải tài khoản có thật/);
  });
});
