// Màn hình đặt tiến độ trên lớp dùng chung cho /admin và /parent (SPEC §5c.2, §11.1 › Tiến độ).
// Server Component thuần: nhận dữ liệu đã đọc qua DAL và Server Action từ trang gọi.

export interface ProgressLesson {
  lesson_id: string;
  seq: number;
  book: string;
  topic: string;
  lesson_no: number;
  title: string;
}

export interface ProgressScopeSummary {
  allowedSkillIds: string[];
  allowedMethods: string[];
  forbiddenTerms: { term: string }[];
  forbiddenMethods: string[];
}

export interface ProgressEditorProps {
  studentId: string;
  subject: string;
  lessons: ProgressLesson[];
  frontierLessonId: string | null;
  previewLessonIds: string[];
  staleReminderEnabled: boolean;
  scope: ProgressScopeSummary | null;
  /** Có ô lý do (admin xem học sinh không liên kết phải ghi lý do). */
  askReason?: boolean;
  setFrontierAction: (form: FormData) => Promise<void>;
  previewAction: (form: FormData) => Promise<void>;
  staleReminderAction: (form: FormData) => Promise<void>;
}

const label = (l: ProgressLesson) => `Bài ${l.lesson_no}. ${l.title} (${l.book})`;

function Hidden({ studentId, subject, askReason }: { studentId: string; subject: string; askReason?: boolean }) {
  return (
    <>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="subject" value={subject} />
      {askReason && <input name="reason" placeholder="Lý do (ghi vào nhật ký, phụ huynh thấy)" required maxLength={300} />}
    </>
  );
}

export function ProgressEditor(props: ProgressEditorProps) {
  const frontier = props.lessons.find((l) => l.lesson_id === props.frontierLessonId) ?? null;
  const later = props.lessons.filter((l) => !frontier || l.seq > frontier.seq);
  return (
    <section className="card">
      <h2>Tiến độ trên lớp — {props.subject === 'math' ? 'Toán' : props.subject}</h2>
      <p>
        {frontier ? (
          <>
            Trên lớp con đã học đến: <strong>{label(frontier)}</strong>
          </>
        ) : (
          <strong>Chưa đặt tiến độ — con chưa mở được phiên môn này.</strong>
        )}
      </p>

      <form action={props.setFrontierAction} className="stack-form">
        <Hidden studentId={props.studentId} subject={props.subject} askReason={props.askReason} />
        <label>
          Trên lớp con đã học đến bài
          <select name="lessonId" required defaultValue={props.frontierLessonId ?? ''}>
            <option value="" disabled>
              — Chọn bài —
            </option>
            {props.lessons.map((l) => (
              <option key={l.lesson_id} value={l.lesson_id}>
                {label(l)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Lưu tiến độ</button>
      </form>

      {frontier && (
        <>
          <h3>Cho học trước một bài</h3>
          <ul>
            {props.previewLessonIds.map((id) => {
              const l = props.lessons.find((x) => x.lesson_id === id);
              return (
                <li key={id}>
                  <form action={props.previewAction} className="inline-form">
                    <Hidden studentId={props.studentId} subject={props.subject} askReason={props.askReason} />
                    <input type="hidden" name="lessonId" value={id} />
                    <input type="hidden" name="allow" value="false" />
                    {l ? label(l) : id} <button type="submit">Bỏ học trước</button>
                  </form>
                </li>
              );
            })}
          </ul>
          <form action={props.previewAction} className="inline-form">
            <Hidden studentId={props.studentId} subject={props.subject} askReason={props.askReason} />
            <input type="hidden" name="allow" value="true" />
            <select name="lessonId" required defaultValue="">
              <option value="" disabled>
                — Bài chưa học —
              </option>
              {later
                .filter((l) => !props.previewLessonIds.includes(l.lesson_id))
                .map((l) => (
                  <option key={l.lesson_id} value={l.lesson_id}>
                    {label(l)}
                  </option>
                ))}
            </select>
            <button type="submit">Cho học trước</button>
          </form>

          <form action={props.staleReminderAction} className="inline-form">
            <Hidden studentId={props.studentId} subject={props.subject} askReason={props.askReason} />
            <input type="hidden" name="enabled" value={props.staleReminderEnabled ? 'false' : 'true'} />
            Nhắc cập nhật sau 14 ngày: <strong>{props.staleReminderEnabled ? 'bật' : 'tắt (nghỉ hè)'}</strong>{' '}
            <button type="submit">{props.staleReminderEnabled ? 'Tắt nhắc' : 'Bật nhắc'}</button>
          </form>
        </>
      )}

      {props.scope && (
        <details>
          <summary>Phạm vi Cú đang áp nếu mở phiên bây giờ</summary>
          <p>
            <strong>Skill được dùng:</strong> {props.scope.allowedSkillIds.join(', ') || '—'}
          </p>
          <p>
            <strong>Cách giải được dùng:</strong> {props.scope.allowedMethods.join('; ') || '—'}
          </p>
          <p>
            <strong>Thuật ngữ bị chặn:</strong> {props.scope.forbiddenTerms.map((t) => t.term).join(', ') || '—'}
          </p>
          <p>
            <strong>Cách giải bị chặn:</strong> {props.scope.forbiddenMethods.join('; ') || '—'}
          </p>
        </details>
      )}
    </section>
  );
}
