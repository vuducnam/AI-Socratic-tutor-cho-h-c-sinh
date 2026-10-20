import 'server-only';
import type { CurriculumScope } from './scope';

// Chuỗi {curriculum_scope} cho tutor/v9 và guard/v7 (SPEC §8.1): bốn dòng, render từ scope_snapshot.
// "Chưa học" ưu tiên thuật ngữ của các bài kế tiếp (forbiddenTerms đã theo thứ tự bài) để prompt ngắn.
const MAX_FORBIDDEN_TERMS = 25;
const MAX_FORBIDDEN_METHODS = 8;

export function renderCurriculumScope(scope: CurriculumScope): string {
  const frontier = scope.frontierLesson
    ? `${scope.frontierLesson.book}, ${scope.frontierLesson.title}`
    : 'chưa đặt tiến độ (chỉ dùng kiến thức các lớp trước)';
  const recent = scope.recentLessons.length ? scope.recentLessons.map((l) => l.title).join('; ') : 'chưa có';
  const methods = scope.allowedMethods.length ? scope.allowedMethods.join('; ') : 'chưa ghi nhận cách giải cụ thể';
  const forbidden = [
    ...scope.forbiddenTerms.slice(0, MAX_FORBIDDEN_TERMS).map((t) => t.term),
    ...scope.forbiddenMethods.slice(0, MAX_FORBIDDEN_METHODS),
  ];
  const lines = [
    `Đã học tới: ${frontier}`,
    `Bài đã học gần nhất: ${recent}`,
    `Cách giải được dùng: ${methods}`,
    `Chưa học, không dùng: ${forbidden.length ? forbidden.join('; ') : 'không có danh sách (vẫn chỉ dùng kiến thức đã học)'}`,
  ];
  if (scope.homeworkExtension) {
    lines.push(`Riêng bài này (bài về nhà) được dùng thêm kiến thức của: ${scope.homeworkExtension.lessonIds.join(', ')}`);
  }
  return lines.join('\n');
}
