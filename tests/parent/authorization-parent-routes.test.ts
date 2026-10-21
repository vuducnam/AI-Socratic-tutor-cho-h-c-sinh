import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ParentActor } from '@/server/dal/actor';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { readStudentExport } from '@/server/dal/export-dal';
import { acknowledgeFlag, listFlags } from '@/server/dal/flags-dal';
import {
  createIndependentResult,
  listIndependentResults,
  listTopicArms,
  setTopicArm,
} from '@/server/dal/independent-results-dal';
import { mintActor } from '@/server/dal/mint-actor';
import { listStudentAccessLog, purgeStudentData } from '@/server/dal/parent-data-dal';
import { updateStudentPreferences } from '@/server/dal/parent-settings-dal';
import { getParentOverview, getSessionTranscript, listStudentSessions } from '@/server/dal/parent-views-dal';
import { getStudentProfile } from '@/server/dal/students-dal';
import { seedStudentEverywhere, type SeededStudent } from '../helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../helpers/test-database';

// Quy tắc cứng 14: phụ huynh B gọi mọi hàm DAL, Server Action, trang và route của khu /parent với con
// của phụ huynh A → bị từ chối và không có thay đổi nào trên dữ liệu của A.

const session = vi.hoisted(() => ({ actor: null as unknown }));

vi.mock('@/server/auth/session', () => {
  class UnauthenticatedError extends Error {
    readonly code = 'UNAUTHENTICATED';
  }
  return {
    UnauthenticatedError,
    requireParentActor: async () => {
      if (!session.actor) throw new UnauthenticatedError('Chưa đăng nhập');
      return session.actor;
    },
  };
});

// Route handler đọc header request (IP, user agent) để ghi access_log.
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest' }) }));

const { acknowledgeFlagAction } = await import('@/app/(parent)/parent/flags/actions');
const { unlockStudentPinAction } = await import('@/app/(parent)/parent/overview-actions');
const { updatePreferencesAction } = await import('@/app/(parent)/parent/settings/actions');
const { purgeStudentAction } = await import('@/app/(parent)/parent/data/actions');
const { createIndependentResultAction, setTopicArmAction } = await import('@/app/(parent)/parent/independent/actions');
const { default: SessionDetailPage } = await import('@/app/(parent)/parent/sessions/[id]/page');
const { default: PurgeConfirmPage } = await import('@/app/(parent)/parent/data/purge/confirm/page');
const { GET: exportRoute } = await import('@/app/api/export/route');

let a: SeededStudent;
let b: SeededStudent;
let parentB: ParentActor;
let flagId: string;

beforeAll(async () => {
  a = await seedStudentEverywhere(appDb());
  b = await seedStudentEverywhere(appDb());
  parentB = mintActor('parent', b.parentId);
  session.actor = parentB;
  const { rows } = await appDb().query<{ id: string }>('SELECT id FROM flags WHERE student_id = $1 LIMIT 1', [a.studentId]);
  flagId = rows[0]!.id;
});
afterAll(closeTestDatabases);

async function rejection(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (err: unknown) => err,
  );
}

/** Server Action/Server Component kết thúc bằng redirect/notFound: lấy digest của lỗi Next. */
async function nextDigest(fn: () => Promise<unknown>): Promise<string> {
  const err = await rejection(fn);
  return String((err as { digest?: string } | null)?.digest ?? err);
}

function form(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
}

async function snapshotOfA() {
  const db = appDb();
  const [student, flag, results, arms] = await Promise.all([
    db.query('SELECT interests_declared, learning_prefs, pin_failed_count FROM students WHERE id = $1', [a.studentId]),
    db.query('SELECT acknowledged_at FROM flags WHERE id = $1', [flagId]),
    db.query('SELECT count(*)::int AS n FROM independent_results WHERE student_id = $1', [a.studentId]),
    db.query('SELECT skill_id, arm FROM topic_arms WHERE student_id = $1 ORDER BY skill_id', [a.studentId]),
  ]);
  return { student: student.rows, flag: flag.rows, results: results.rows, arms: arms.rows };
}

describe('DAL khu /parent: phụ huynh B với con của A', () => {
  const calls: [string, () => Promise<unknown>][] = [
    ['listStudentSessions', () => listStudentSessions(parentB, { studentId: a.studentId })],
    ['getSessionTranscript', () => getSessionTranscript(parentB, { studentId: a.studentId, sessionId: a.sessionId })],
    ['listFlags', () => listFlags(parentB, { studentId: a.studentId })],
    ['acknowledgeFlag', () => acknowledgeFlag(parentB, { studentId: a.studentId, flagId })],
    ['getStudentProfile', () => getStudentProfile(parentB, { studentId: a.studentId })],
    [
      'updateStudentPreferences',
      () =>
        updateStudentPreferences(parentB, {
          studentId: a.studentId,
          preferences: { interests: ['x'], sessionMinutes: 10, dailyLimitMinutes: 20 },
        }),
    ],
    ['listStudentAccessLog', () => listStudentAccessLog(parentB, { studentId: a.studentId })],
    ['purgeStudentData', () => purgeStudentData(parentB, { studentId: a.studentId, confirmDisplayName: 'Bé Test' })],
    ['readStudentExport', () => readStudentExport(parentB, { studentId: a.studentId })],
    [
      'createIndependentResult',
      () => createIndependentResult(parentB, { studentId: a.studentId, result: { type: 'paper_quiz', takenOn: '2026-09-01' } }),
    ],
    ['listIndependentResults', () => listIndependentResults(parentB, { studentId: a.studentId })],
    ['listTopicArms', () => listTopicArms(parentB, { studentId: a.studentId })],
    ['setTopicArm', () => setTopicArm(parentB, { studentId: a.studentId, skillId: 'TEST.DECIMAL.COMPARE', arm: 'without_cu' })],
  ];

  it.each(calls)('%s → AuthorizationError', async (_name, call) => {
    expect(await rejection(call)).toBeInstanceOf(AuthorizationError);
  });

  it('tổng quan của B không chứa con của A', async () => {
    const overview = await getParentOverview(parentB);
    expect(overview.map((c) => c.id)).toEqual([b.studentId]);
  });
});

describe('Server Action, trang và route khu /parent: phụ huynh B với con của A', () => {
  it('mọi Server Action bị từ chối và dữ liệu của A không đổi', async () => {
    // A đang bị khoá PIN: B không được mở khoá hộ.
    await appDb().query('UPDATE students SET pin_failed_count = 7 WHERE id = $1', [a.studentId]);
    const before = await snapshotOfA();
    const attempts: [string, () => Promise<unknown>][] = [
      ['acknowledgeFlagAction', () => acknowledgeFlagAction(form({ studentId: a.studentId, flagId }))],
      ['unlockStudentPinAction', () => unlockStudentPinAction(form({ studentId: a.studentId }))],
      [
        'updatePreferencesAction',
        () => updatePreferencesAction(form({ studentId: a.studentId, interests: 'x', sessionMinutes: '10', dailyLimitMinutes: '20' })),
      ],
      [
        'purgeStudentAction',
        () => purgeStudentAction(form({ studentId: a.studentId, confirmDisplayName: 'Bé Test', understood: 'yes' })),
      ],
      [
        'createIndependentResultAction',
        () => createIndependentResultAction(form({ studentId: a.studentId, type: 'paper_quiz', takenOn: '2026-09-01' })),
      ],
      [
        'setTopicArmAction',
        () => setTopicArmAction(form({ studentId: a.studentId, skillId: 'TEST.DECIMAL.COMPARE', arm: 'without_cu' })),
      ],
    ];
    for (const [name, attempt] of attempts) {
      const digest = await nextDigest(attempt);
      expect(digest, name).toMatch(/NEXT_REDIRECT/);
      // digest: NEXT_REDIRECT;<type>;<url>;<status>;
      const target = new URL(digest.split(';')[2] ?? '', 'http://localhost');
      expect(target.searchParams.get('err'), name).toBe('Không có quyền với hồ sơ này');
    }
    expect(await snapshotOfA()).toEqual(before);
    expect((await appDb().query('SELECT 1 FROM students WHERE id = $1', [a.studentId])).rowCount).toBe(1);
  });

  it('trang transcript với phiên của A → 404', async () => {
    const digest = await nextDigest(() =>
      SessionDetailPage({
        params: Promise.resolve({ id: a.sessionId }),
        searchParams: Promise.resolve({ studentId: a.studentId }),
      }),
    );
    expect(digest).toMatch(/404/);
  });

  it('trang xác nhận xoá với con của A → 404', async () => {
    const digest = await nextDigest(() => PurgeConfirmPage({ searchParams: Promise.resolve({ studentId: a.studentId }) }));
    expect(digest).toMatch(/404/);
  });

  it('route export với con của A → 403', async () => {
    const res = await exportRoute(new Request(`http://localhost/api/export?studentId=${a.studentId}`));
    expect(res.status).toBe(403);
  });
});
