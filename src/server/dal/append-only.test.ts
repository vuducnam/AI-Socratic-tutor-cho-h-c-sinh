import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDb, appendOnlyTables, closeTestDatabases, ownerDb } from '../../../tests/helpers/test-database';
import { seedStudentEverywhere, type SeededStudent } from '../../../tests/helpers/seed-student-everywhere';

// Quy tắc cứng 3: bảng append-only chặn UPDATE/DELETE/TRUNCATE, kể cả với role sở hữu bảng.
const EXPECTED = [
  'access_log',
  'guard_verdicts',
  'label_corrections',
  'llm_calls',
  'mastery_events',
  'school_progress_events',
  'turns',
];

let seeded: SeededStudent;

beforeAll(async () => {
  seeded = await seedStudentEverywhere(appDb());
});
afterAll(closeTestDatabases);

describe('bảng append-only', () => {
  it('đúng 7 bảng của quy tắc cứng 3 và school_progress_events', async () => {
    expect((await appendOnlyTables()).sort()).toEqual(EXPECTED);
  });

  for (const table of EXPECTED) {
    describe(table, () => {
      const filter = table === 'turns' || table === 'guard_verdicts' ? 'session_id' : 'student_id';
      const target = () => (filter === 'session_id' ? seeded.sessionId : seeded.studentId);

      it('cu_app không UPDATE được', async () => {
        await expect(
          appDb().query(`UPDATE ${table} SET created_at = now() WHERE ${filter} = $1`, [target()]),
        ).rejects.toThrow();
      });

      it('cu_app không DELETE được', async () => {
        await expect(appDb().query(`DELETE FROM ${table} WHERE ${filter} = $1`, [target()])).rejects.toThrow();
      });

      it('cu_app không TRUNCATE được', async () => {
        await expect(appDb().query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow();
      });

      it('trigger chặn cả cu_owner (UPDATE, DELETE, TRUNCATE)', async () => {
        const db = ownerDb();
        await expect(db.query(`UPDATE ${table} SET created_at = now() WHERE ${filter} = $1`, [target()])).rejects.toThrow(
          /append-only/,
        );
        await expect(db.query(`DELETE FROM ${table} WHERE ${filter} = $1`, [target()])).rejects.toThrow(/append-only/);
        await expect(db.query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow(/append-only/);
      });

      it('vẫn INSERT/SELECT được', async () => {
        const { rows } = await appDb().query(`SELECT count(*)::int AS n FROM ${table} WHERE ${filter} = $1`, [target()]);
        expect(rows[0].n).toBeGreaterThan(0);
      });
    });
  }
});
