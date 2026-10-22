'use client';

import { OwlAvatar } from './owl-avatar';
import type { SubjectDto } from './chat-types';

// Màn chọn môn: chỉ hiện khi con có từ hai môn đã được bố mẹ đặt tiến độ (quy tắc cứng 15).

const SUBJECT_ICON: Record<string, string> = { math: '➗', history_geography: '🧭' };

export function SubjectPicker({ subjects, onPick }: { subjects: SubjectDto[]; onPick: (subjectId: string) => void }) {
  return (
    <section className="center-screen subject-picker">
      <OwlAvatar size={96} />
      <h1>Hôm nay bạn học môn gì?</h1>
      <div className="subject-cards">
        {subjects.map((s) => (
          <button key={s.id} type="button" className="subject-card" onClick={() => onPick(s.id)}>
            <span className="subject-icon" aria-hidden="true">
              {SUBJECT_ICON[s.id] ?? '📘'}
            </span>
            {s.name}
          </button>
        ))}
      </div>
    </section>
  );
}
