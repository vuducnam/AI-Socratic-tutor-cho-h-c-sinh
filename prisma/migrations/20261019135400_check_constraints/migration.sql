-- CHECK constraints cho enum dạng text (SPEC §3). Prisma không biểu diễn được CHECK nên viết tay.

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'parent'));
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'));

ALTER TABLE students ADD CONSTRAINT students_gender_check CHECK (gender IN ('male', 'female'));
ALTER TABLE students ADD CONSTRAINT students_status_check CHECK (status IN ('active', 'disabled'));
ALTER TABLE students ADD CONSTRAINT students_pin_failed_count_check CHECK (pin_failed_count >= 0);

ALTER TABLE pin_lockouts ADD CONSTRAINT pin_lockouts_device_class_check CHECK (device_class IN ('trusted', 'unknown'));
ALTER TABLE pin_lockouts ADD CONSTRAINT pin_lockouts_failed_count_check CHECK (failed_count >= 0);

ALTER TABLE skills ADD CONSTRAINT skills_source_check CHECK (source ? 'official_url' AND source ? 'lesson');
ALTER TABLE curriculum_lessons ADD CONSTRAINT curriculum_lessons_source_check CHECK (source ? 'official_url');

ALTER TABLE school_progress_events ADD CONSTRAINT school_progress_events_action_check
  CHECK (action IN ('set_frontier', 'allow_preview', 'revoke_preview', 'grade_up', 'set_stale_reminder'));
ALTER TABLE school_progress_events ADD CONSTRAINT school_progress_events_via_check
  CHECK (via IN ('parent', 'admin', 'suggestion'));
ALTER TABLE progress_suggestions ADD CONSTRAINT progress_suggestions_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected'));

ALTER TABLE sessions ADD CONSTRAINT sessions_mode_check CHECK (mode IN ('solve', 'argue'));
ALTER TABLE sessions ADD CONSTRAINT sessions_opened_via_check CHECK (opened_via IN ('student', 'reminder'));

ALTER TABLE problems ADD CONSTRAINT problems_origin_check CHECK (origin IN ('homework', 'generated', 'mission'));
-- Bài do Cú tạo và nhiệm vụ luôn gắn với một tình huống đời thật (quy tắc cứng 13).
ALTER TABLE problems ADD CONSTRAINT problems_life_context_required_check
  CHECK (origin = 'homework' OR life_context_id IS NOT NULL);

ALTER TABLE turns ADD CONSTRAINT turns_role_check CHECK (role IN ('student', 'tutor', 'system'));
ALTER TABLE turns ADD CONSTRAINT turns_turn_kind_check
  CHECK (turn_kind IN ('normal', 'hook', 'transfer_question', 'transfer_answer'));

ALTER TABLE llm_calls ADD CONSTRAINT llm_calls_mode_check CHECK (mode IN ('live', 'eval'));
-- Lượt gọi liên quan học sinh phải có student_id để purge/export thấy (lệch SPEC §3 có chủ đích).
ALTER TABLE llm_calls ADD CONSTRAINT llm_calls_student_required_check CHECK (
  student_id IS NOT NULL OR purpose NOT IN (
    'tutor', 'guard', 'presolve', 'ocr', 'hook', 'contextualize', 'transfer',
    'learner_summary', 'report_narrative', 'mission_extract', 'stt'
  )
);

ALTER TABLE guard_verdicts ADD CONSTRAINT guard_verdicts_checker_check CHECK (checker IN ('code', 'llm'));
ALTER TABLE guard_verdicts ADD CONSTRAINT guard_verdicts_verdict_check CHECK (verdict IN ('pass', 'block'));
ALTER TABLE guard_verdicts ADD CONSTRAINT guard_verdicts_llm_call_required_check
  CHECK (checker = 'code' OR llm_call_id IS NOT NULL);

ALTER TABLE mastery ADD CONSTRAINT mastery_p_check CHECK (p_mastery >= 0 AND p_mastery <= 1);
ALTER TABLE learner_misconceptions ADD CONSTRAINT learner_misconceptions_status_check
  CHECK (status IN ('active', 'self_corrected', 'stable'));
ALTER TABLE flags ADD CONSTRAINT flags_severity_check CHECK (severity IN ('info', 'warning', 'high'));

ALTER TABLE independent_results ADD CONSTRAINT independent_results_type_check
  CHECK (type IN ('class_test', 'paper_quiz', 'teacher_note'));
ALTER TABLE topic_arms ADD CONSTRAINT topic_arms_arm_check CHECK (arm IN ('with_cu', 'without_cu'));
ALTER TABLE reports ADD CONSTRAINT reports_type_check CHECK (type IN ('session', 'weekly', 'eight_week'));
ALTER TABLE decisions ADD CONSTRAINT decisions_decision_check CHECK (decision IN ('continue', 'adjust', 'stop'));
ALTER TABLE decisions ADD CONSTRAINT decisions_reason_check CHECK (length(btrim(reason)) > 0);

ALTER TABLE life_contexts ADD CONSTRAINT life_contexts_theme_check CHECK (theme IN
  ('market', 'cooking', 'sport', 'nature', 'animals', 'travel', 'home', 'game', 'school', 'other'));
ALTER TABLE life_contexts ADD CONSTRAINT life_contexts_grade_check CHECK (min_grade <= max_grade);
ALTER TABLE missions ADD CONSTRAINT missions_status_check CHECK (status IN ('assigned', 'done', 'skipped'));
ALTER TABLE session_feedback ADD CONSTRAINT session_feedback_rating_check CHECK (rating IN ('fun', 'ok', 'boring'));

ALTER TABLE access_log ADD CONSTRAINT access_log_actor_type_check
  CHECK (actor_type IN ('admin', 'parent', 'student', 'system', 'anonymous'));
ALTER TABLE system_alerts ADD CONSTRAINT system_alerts_severity_check CHECK (severity IN ('info', 'warning', 'high'));

-- turns và llm_calls của một lượt ghi trong cùng transaction; llm_calls.turn_id kiểm FK lúc commit.
ALTER TABLE llm_calls ALTER CONSTRAINT llm_calls_turn_id_fkey DEFERRABLE INITIALLY DEFERRED;
