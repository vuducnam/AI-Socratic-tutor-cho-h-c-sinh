import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedStudentEverywhere, type SeededStudent } from '../../../tests/helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../../../tests/helpers/test-database';
import { AuthorizationError } from './actor-authorization';
import { mintActor } from './mint-actor';
import { listStudentAccessLog } from './parent-data-dal';
import { updateStudentPreferences, updateStudentVoicePrefs } from './parent-settings-dal';
import { DEFAULT_VOICE_PREFS, getStudentVoicePrefs, readVoicePrefs } from './voice-prefs-dal';

// Cài đặt giọng nói trong students.learning_prefs: mặc định an toàn (cloud tắt), phụ huynh liên kết sửa
// được và có access_log, phụ huynh khác không đọc/sửa được.

let a: SeededStudent;
let b: SeededStudent;
beforeAll(async () => {
  a = await seedStudentEverywhere(appDb());
  b = await seedStudentEverywhere(appDb());
});
afterAll(closeTestDatabases);

describe('readVoicePrefs', () => {
  it('thiếu khoá hoặc sai kiểu → mặc định; cloud chỉ bật khi đúng true', () => {
    expect(readVoicePrefs(null)).toEqual(DEFAULT_VOICE_PREFS);
    expect(readVoicePrefs({ stt_cloud_fallback: 'true', tts_autoplay: 1, stt_language: 'fr' })).toEqual({
      ttsAutoplay: false,
      sttCloudFallback: false,
      sttLanguage: 'vi',
    });
    expect(readVoicePrefs({ stt_cloud_fallback: true, tts_autoplay: true, stt_language: 'en' })).toEqual({
      ttsAutoplay: true,
      sttCloudFallback: true,
      sttLanguage: 'en',
    });
  });
});

describe('getStudentVoicePrefs / updateStudentVoicePrefs', () => {
  it('học sinh mới: mặc định tự đọc tắt, cloud tắt, tiếng Việt', async () => {
    expect(await getStudentVoicePrefs(mintActor('student', a.studentId), a.studentId)).toEqual({
      ttsAutoplay: false,
      sttCloudFallback: false,
      sttLanguage: 'vi',
    });
  });

  it('phụ huynh liên kết sửa được, giữ các khoá learning_prefs khác, ghi access_log', async () => {
    await appDb().query(`UPDATE students SET learning_prefs = '{"session_minutes": 20}' WHERE id = $1`, [a.studentId]);
    const parent = mintActor('parent', a.parentId);
    await updateStudentVoicePrefs(parent, { studentId: a.studentId, prefs: { ttsAutoplay: true, sttCloudFallback: true, sttLanguage: 'en' } });

    const { rows } = await appDb().query<{ learning_prefs: Record<string, unknown> }>('SELECT learning_prefs FROM students WHERE id = $1', [a.studentId]);
    expect(rows[0]!.learning_prefs).toEqual({ session_minutes: 20, tts_autoplay: true, stt_cloud_fallback: true, stt_language: 'en' });
    expect(await getStudentVoicePrefs(mintActor('student', a.studentId), a.studentId)).toEqual({
      ttsAutoplay: true,
      sttCloudFallback: true,
      sttLanguage: 'en',
    });

    const log = await appDb().query(
      `SELECT 1 FROM access_log WHERE actor_id = $1 AND student_id = $2 AND action = 'write' AND resource = 'students:learning_prefs'`,
      [a.parentId, a.studentId],
    );
    expect(log.rowCount).toBeGreaterThan(0);
  });

  it('phụ huynh không liên kết và học sinh bị từ chối', async () => {
    const stranger = mintActor('parent', b.parentId);
    await expect(getStudentVoicePrefs(stranger, a.studentId)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      updateStudentVoicePrefs(stranger, { studentId: a.studentId, prefs: { ttsAutoplay: false, sttCloudFallback: true, sttLanguage: 'vi' } }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      updateStudentVoicePrefs(mintActor('student', a.studentId), {
        studentId: a.studentId,
        prefs: { ttsAutoplay: false, sttCloudFallback: true, sttLanguage: 'vi' },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('learning_prefs: gộp JSONB nguyên tử', () => {
  const learningPrefs = async (studentId: string) =>
    (await appDb().query<{ learning_prefs: Record<string, unknown> }>('SELECT learning_prefs FROM students WHERE id = $1', [studentId])).rows[0]!
      .learning_prefs;

  it('hai lần cập nhật một phần nối tiếp giữ khoá của nhau (và khoá lạ đã có)', async () => {
    const c = await seedStudentEverywhere(appDb());
    await appDb().query(`UPDATE students SET learning_prefs = '{"other_key": "giữ"}' WHERE id = $1`, [c.studentId]);
    const parent = mintActor('parent', c.parentId);
    await updateStudentPreferences(parent, { studentId: c.studentId, preferences: { interests: ['mèo'], sessionMinutes: 20, dailyLimitMinutes: 40 } });
    await updateStudentVoicePrefs(parent, { studentId: c.studentId, prefs: { ttsAutoplay: true, sttCloudFallback: false, sttLanguage: 'en' } });
    expect(await learningPrefs(c.studentId)).toEqual({
      other_key: 'giữ',
      session_minutes: 20,
      daily_limit_minutes: 40,
      tts_autoplay: true,
      stt_cloud_fallback: false,
      stt_language: 'en',
    });
    await updateStudentPreferences(parent, { studentId: c.studentId, preferences: { interests: [], sessionMinutes: 15, dailyLimitMinutes: 30 } });
    expect(await learningPrefs(c.studentId)).toMatchObject({ other_key: 'giữ', session_minutes: 15, tts_autoplay: true, stt_language: 'en' });
  });

  it('hai lần lưu đồng thời không ghi đè nhau', async () => {
    const c = await seedStudentEverywhere(appDb());
    const parent = mintActor('parent', c.parentId);
    await Promise.all([
      updateStudentPreferences(parent, { studentId: c.studentId, preferences: { interests: [], sessionMinutes: 25, dailyLimitMinutes: 50 } }),
      updateStudentVoicePrefs(parent, { studentId: c.studentId, prefs: { ttsAutoplay: true, sttCloudFallback: false, sttLanguage: 'vi' } }),
    ]);
    expect(await learningPrefs(c.studentId)).toMatchObject({ session_minutes: 25, daily_limit_minutes: 50, tts_autoplay: true, stt_language: 'vi' });
  });
});

describe('access_log riêng khi bật/tắt STT cloud', () => {
  it('chỉ ghi khi giá trị đổi; phụ huynh thấy dòng log ở nhật ký truy cập', async () => {
    const c = await seedStudentEverywhere(appDb());
    const parent = mintActor('parent', c.parentId);
    const save = (sttCloudFallback: boolean, ttsAutoplay = false) =>
      updateStudentVoicePrefs(parent, { studentId: c.studentId, prefs: { ttsAutoplay, sttCloudFallback, sttLanguage: 'vi' } });
    const cloudLog = async () =>
      (
        await appDb().query<{ resource: string; actor_id: string }>(
          `SELECT resource, actor_id FROM access_log WHERE student_id = $1 AND resource LIKE 'students:voice_prefs:stt_cloud_fallback=%' ORDER BY id`,
          [c.studentId],
        )
      ).rows;

    await save(false); // mặc định đã tắt → không đổi, không ghi
    await save(false, true); // chỉ đổi tự đọc → không ghi
    expect(await cloudLog()).toEqual([]);

    await save(true);
    await save(true); // lưu lại cùng giá trị → không ghi thêm
    await save(false);
    expect(await cloudLog()).toEqual([
      { resource: 'students:voice_prefs:stt_cloud_fallback=on', actor_id: c.parentId },
      { resource: 'students:voice_prefs:stt_cloud_fallback=off', actor_id: c.parentId },
    ]);

    const visible = await listStudentAccessLog(parent, { studentId: c.studentId });
    const resources = visible.map((r) => r.resource);
    expect(resources).toContain('students:voice_prefs:stt_cloud_fallback=on');
    expect(resources).toContain('students:voice_prefs:stt_cloud_fallback=off');
  });

  it('admin (học sinh không liên kết, có lý do) bật cloud → dòng log có lý do, phụ huynh thấy', async () => {
    const c = await seedStudentEverywhere(appDb());
    const admin = mintActor('admin', c.adminId, 'hỗ trợ cài đặt giọng nói');
    await updateStudentVoicePrefs(admin, { studentId: c.studentId, prefs: { ttsAutoplay: false, sttCloudFallback: true, sttLanguage: 'vi' } });
    const visible = await listStudentAccessLog(mintActor('parent', c.parentId), { studentId: c.studentId });
    expect(visible.find((r) => r.resource === 'students:voice_prefs:stt_cloud_fallback=on')).toMatchObject({
      actor_type: 'admin',
      reason: 'hỗ trợ cài đặt giọng nói',
    });
  });
});
