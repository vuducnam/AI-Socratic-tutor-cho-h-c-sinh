import { randomUUID } from 'node:crypto';
import type pg from 'pg';

// Dựng một học sinh giả có dữ liệu ở MỌI bảng chứa dữ liệu học sinh (kể cả llm_calls ngoài phiên,
// guard_verdicts do code). Test purge/export kiểm "mọi bảng > 0 trước, = 0 sau", nên bảng mới có
// student_id mà quên thêm vào đây sẽ làm test fail.

export interface SeededStudent {
  studentId: string;
  parentId: string;
  adminId: string;
  sessionId: string;
  turnIds: string[];
  fileUris: string[];
}

const SKILL_ID = 'TEST.DECIMAL.COMPARE';
const MISCONCEPTION_ID = 'TEST.DECIMAL.COMPARE.LONGER_IS_BIGGER';
const LESSON_ID = 'TEST5.T1.B1';
const LIFE_CONTEXT_ID = 'TEST.CTX.MARKET';

async function ensureSharedCatalog(db: pg.Pool | pg.PoolClient): Promise<void> {
  await db.query(
    `INSERT INTO skills (skill_id, subject, grade_introduced, name, source)
     VALUES ($1, 'math', 5, 'So sánh số thập phân (test)',
             '{"official_url":"https://taphuan.nxbgd.vn/test","lesson":"Bài test"}')
     ON CONFLICT DO NOTHING`,
    [SKILL_ID],
  );
  await db.query(
    `INSERT INTO misconceptions (id, skill_id, description) VALUES ($1, $2, 'Nghĩ số dài hơn thì lớn hơn')
     ON CONFLICT DO NOTHING`,
    [MISCONCEPTION_ID, SKILL_ID],
  );
  await db.query(
    `INSERT INTO curriculum_lessons (lesson_id, subject, grade, seq, book, topic, lesson_no, title, skill_ids, source)
     VALUES ($1, 'test-math', 5, 1, 'Toán 5, Tập 1', 'TEST', 1, 'Bài test', ARRAY[$2],
             '{"official_url":"https://taphuan.nxbgd.vn/test"}')
     ON CONFLICT DO NOTHING`,
    [LESSON_ID, SKILL_ID],
  );
  await db.query(
    `INSERT INTO life_contexts (id, skill_id, theme, template, min_grade, max_grade, safety, content_hash)
     VALUES ($1, $2, 'market', '{"setup":"x","real_question":"y","variables":{}}', 5, 5,
             '{"adult_required":false,"notes":""}', 'test')
     ON CONFLICT DO NOTHING`,
    [LIFE_CONTEXT_ID, SKILL_ID],
  );
}

export async function seedStudentEverywhere(db: pg.Pool): Promise<SeededStudent> {
  const client = await db.connect();
  const tag = randomUUID().slice(0, 8);
  try {
    await client.query('BEGIN');
    await ensureSharedCatalog(client);

    const insert = async (sql: string, params: unknown[]): Promise<string> => {
      const { rows } = await client.query<{ id: string }>(sql, params);
      return rows[0]?.id ?? '';
    };

    const adminId = await insert(
      `INSERT INTO users (role, name, email, password_hash) VALUES ('admin', 'Admin test', $1, 'x') RETURNING id`,
      [`admin-${tag}@test.local`],
    );
    const parentId = await insert(
      `INSERT INTO users (role, name, email, password_hash, created_by)
       VALUES ('parent', 'Phụ huynh test', $1, 'x', $2) RETURNING id`,
      [`parent-${tag}@test.local`, adminId],
    );
    const studentId = await insert(
      `INSERT INTO students (username, display_name, gender, pin_hash, created_by, grade, preset, address, companion, is_family)
       VALUES ($1, 'Bé Test', 'female', 'x', $2, 5, 'grade5', '{"tutor_self":"Cú","student":"Bé"}', '{"name":"Cú"}', false)
       RETURNING id`,
      [`hs-${tag}`, adminId],
    );
    const consentUri = `storage:test/${tag}/consent.pdf`;
    await client.query(
      `INSERT INTO consents (student_id, parent_id, version, text_snapshot, document_uri, recorded_by, signed_at)
       VALUES ($1, $2, 'v1', 'Đồng ý (test)', $3, $4, now())`,
      [studentId, parentId, consentUri, adminId],
    );
    await client.query(`INSERT INTO parent_student (parent_id, student_id) VALUES ($1, $2)`, [parentId, studentId]);
    await client.query(
      `INSERT INTO pin_lockouts (student_id, device_class, failed_count) VALUES ($1, 'unknown', 1)`,
      [studentId],
    );
    await client.query(`INSERT INTO trusted_devices (student_id, token_hash) VALUES ($1, $2)`, [
      studentId,
      `hash-${tag}`,
    ]);
    await client.query(
      `INSERT INTO school_progress (student_id, subject, frontier_lesson_id, set_by) VALUES ($1, 'test-math', $2, $3)`,
      [studentId, LESSON_ID, parentId],
    );
    await client.query(
      `INSERT INTO school_progress_events (student_id, subject, action, lesson_id, via, actor_id)
       VALUES ($1, 'test-math', 'set_frontier', $2, 'parent', $3)`,
      [studentId, LESSON_ID, parentId],
    );

    const sessionId = await insert(
      `INSERT INTO sessions (student_id, subject, mode, scope_snapshot) VALUES ($1, 'test-math', 'solve', '{}') RETURNING id`,
      [studentId],
    );
    const problemUri = `storage:test/${tag}/problem.webp`;
    const problemId = await insert(
      `INSERT INTO problems (session_id, student_id, origin, image_uri, confirmed_text, confirmed_by_student, skill_ids)
       VALUES ($1, $2, 'homework', $3, 'So sánh 0,45 và 0,5', true, ARRAY[$4]) RETURNING id`,
      [sessionId, studentId, problemUri, SKILL_ID],
    );
    await client.query(
      `INSERT INTO problems (session_id, student_id, origin, life_context_id, confirmed_text)
       VALUES ($1, $2, 'generated', $3, 'Bài tình huống test')`,
      [sessionId, studentId, LIFE_CONTEXT_ID],
    );
    await client.query(
      `INSERT INTO progress_suggestions (student_id, subject, lesson_id, evidence_problem_id) VALUES ($1, 'test-math', $2, $3)`,
      [studentId, LESSON_ID, problemId],
    );

    // Một lượt: turn và llm_calls ghi trong cùng transaction (turn_id FK deferrable).
    const turnIds = [randomUUID(), randomUUID()];
    const tutorCallId = await insert(
      `INSERT INTO llm_calls (student_id, session_id, turn_id, purpose, provider, model, request, response)
       VALUES ($1, $2, $3, 'tutor', 'anthropic', 'test-model', '{"messages":[]}', '{"text":"?"}') RETURNING id`,
      [studentId, sessionId, turnIds[1]],
    );
    await client.query(
      `INSERT INTO turns (id, session_id, seq, role, content, turn_kind) VALUES
         ($1, $3, 1, 'student', 'Con nghĩ 0,45 lớn hơn', 'normal'),
         ($2, $3, 2, 'tutor', 'Con thử nghĩ về cái bánh nhé?', 'normal')`,
      [turnIds[0], turnIds[1], sessionId],
    );
    const presolveCallId = await insert(
      `INSERT INTO llm_calls (student_id, session_id, purpose, provider, model, request)
       VALUES ($1, $2, 'presolve', 'anthropic', 'test-model', '{}') RETURNING id`,
      [studentId, sessionId],
    );
    await client.query(
      `INSERT INTO solution_plans (problem_id, plan, final_answer, verified, llm_call_id)
       VALUES ($1, '{"steps":[]}', '{"value":"0,5"}', true, $2)`,
      [problemId, presolveCallId],
    );
    const guardCallId = await insert(
      `INSERT INTO llm_calls (student_id, session_id, turn_id, purpose, provider, model, request)
       VALUES ($1, $2, $3, 'guard', 'anthropic', 'test-model', '{}') RETURNING id`,
      [studentId, sessionId, turnIds[1]],
    );
    await client.query(
      `INSERT INTO guard_verdicts (session_id, turn_id, checker, tutor_llm_call_id, verdict, reasons)
       VALUES ($1, $2, 'code', $3, 'block', ARRAY['LENGTH'])`,
      [sessionId, turnIds[1], tutorCallId],
    );
    await client.query(
      `INSERT INTO guard_verdicts (session_id, turn_id, checker, llm_call_id, tutor_llm_call_id, verdict)
       VALUES ($1, $2, 'llm', $3, $4, 'pass')`,
      [sessionId, turnIds[1], guardCallId, tutorCallId],
    );
    // llm_calls ngoài phiên (báo cáo, OCR): chỉ có student_id.
    const reportCallId = await insert(
      `INSERT INTO llm_calls (student_id, purpose, provider, model, request)
       VALUES ($1, 'report_narrative', 'anthropic', 'test-model', '{}') RETURNING id`,
      [studentId],
    );
    await client.query(
      `INSERT INTO llm_calls (student_id, purpose, provider, model, request) VALUES ($1, 'ocr', 'anthropic', 'test-model', '{}')`,
      [studentId],
    );

    await client.query(`INSERT INTO mastery (student_id, skill_id, p_mastery) VALUES ($1, $2, 0.5)`, [studentId, SKILL_ID]);
    await client.query(
      `INSERT INTO mastery_events (student_id, skill_id, p_before, p_after, evidence_turn_ids) VALUES ($1, $2, 0.4, 0.5, $3)`,
      [studentId, SKILL_ID, turnIds],
    );
    await client.query(
      `INSERT INTO learner_misconceptions (student_id, misconception_id, status, evidence_turn_ids) VALUES ($1, $2, 'active', $3)`,
      [studentId, MISCONCEPTION_ID, turnIds],
    );
    await client.query(
      `INSERT INTO review_schedule (student_id, skill_id, due_at, interval_days) VALUES ($1, $2, now(), 1)`,
      [studentId, SKILL_ID],
    );
    await client.query(
      `INSERT INTO flags (student_id, session_id, type, severity, evidence_turn_ids) VALUES ($1, $2, 'test', 'info', $3)`,
      [studentId, sessionId, turnIds],
    );
    await client.query(
      `INSERT INTO label_corrections (student_id, target_table, target_id, new_value, corrected_by)
       VALUES ($1, 'mastery', $2, '{"p":0.6}', $3)`,
      [studentId, SKILL_ID, parentId],
    );
    await client.query(
      `INSERT INTO independent_results (student_id, type, skill_ids, score, max_score, taken_on, entered_by)
       VALUES ($1, 'class_test', ARRAY[$2], 9, 10, current_date, $3)`,
      [studentId, SKILL_ID, parentId],
    );
    await client.query(`INSERT INTO topic_arms (student_id, skill_id, arm) VALUES ($1, $2, 'with_cu')`, [studentId, SKILL_ID]);
    const reportId = await insert(
      `INSERT INTO reports (student_id, session_id, type, period_start, period_end, metrics, llm_call_id)
       VALUES ($1, $2, 'session', now(), now(), '{}', $3) RETURNING id`,
      [studentId, sessionId, reportCallId],
    );
    await client.query(
      `INSERT INTO decisions (student_id, report_id, decision, reason, decided_by) VALUES ($1, $2, 'continue', 'Ổn', $3)`,
      [studentId, reportId, parentId],
    );
    const missionId = await insert(
      `INSERT INTO missions (student_id, life_context_id, instructions, adult_required) VALUES ($1, $2, 'Đo cùng bố', true) RETURNING id`,
      [studentId, LIFE_CONTEXT_ID],
    );
    const missionUri = `storage:test/${tag}/mission.webp`;
    await client.query(
      `INSERT INTO mission_artifacts (mission_id, student_id, image_uri) VALUES ($1, $2, $3)`,
      [missionId, studentId, missionUri],
    );
    await client.query(`INSERT INTO session_feedback (session_id, student_id, rating) VALUES ($1, $2, 'fun')`, [
      sessionId,
      studentId,
    ]);
    await client.query(
      `INSERT INTO access_log (actor_type, actor_id, student_id, action, resource, ip, user_agent)
       VALUES ('parent', $1, $2, 'read', 'sessions', '203.0.113.7', 'test-agent')`,
      [parentId, studentId],
    );
    await client.query(`INSERT INTO purge_requests (student_id, requested_by, reason) VALUES ($1, $2, 'test cũ')`, [
      studentId,
      parentId,
    ]);

    await client.query('COMMIT');
    return { studentId, parentId, adminId, sessionId, turnIds, fileUris: [consentUri, problemUri, missionUri] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
