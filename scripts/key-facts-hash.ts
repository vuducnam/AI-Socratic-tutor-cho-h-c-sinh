import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { keyFactsLessonHash, type KeyFactLessonDef } from '@/server/domain/curriculum/key-facts-yaml-schema';

// pnpm key-facts:hash — in content_hash hiện tại của từng bài trong data/key-facts/** để chủ dự án điền vào
// approved: { by, at, content_hash } sau khi đối chiếu bài đó với SGK. Không ghi gì vào file hay DB.

for (const subject of readdirSync('data/key-facts')) {
  for (const file of readdirSync(join('data/key-facts', subject)).filter((f) => f.endsWith('.yaml'))) {
    const doc = parse(readFileSync(join('data/key-facts', subject, file), 'utf8')) as { lessons: KeyFactLessonDef[] };
    console.log(`# ${subject}/${file}`);
    for (const raw of doc.lessons) {
      // Cùng cách đọc như seed: pages luôn là chuỗi.
      const lesson = { ...raw, facts: (raw.facts ?? []).map((x) => ({ ...x, pages: String(x.pages) })) };
      const status = lesson.approved
        ? lesson.approved.content_hash === keyFactsLessonHash({ ...lesson, objectives: lesson.objectives ?? [], facts: lesson.facts ?? [] })
          ? 'đã duyệt'
          : 'MẤT DUYỆT (đã sửa sau khi duyệt)'
        : 'chưa duyệt';
      const hash = keyFactsLessonHash({ ...lesson, objectives: lesson.objectives ?? [], facts: lesson.facts ?? [] });
      console.log(`${lesson.lesson_id}\t${(lesson.facts ?? []).length} ý\t${hash}\t${status}`);
    }
  }
}
