import 'server-only';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import type { Actor } from '@/server/dal/actor';
import { markKeyFactsLessonApproved } from '@/server/dal/key-facts-dal';
import { getOwnAccount } from '@/server/dal/users-dal';
import { keyFactsLessonHash } from './key-facts-yaml-schema';

// Duyệt ý chính trong /parent › Duyệt › Ý chính (SPEC §5d): phụ huynh đối chiếu một bài với SGK rồi duyệt cả bài.
// Ghi trạng thái duyệt NGƯỢC vào YAML (approved: {by, at, content_hash}) để seed ở DB khác mang theo, rồi cập nhật DB.
// Hash trong YAML phải khớp hash phụ huynh đang xem; ý chính đổi sau khi duyệt thì mất duyệt.

export function keyFactsDir(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.KEY_FACTS_DIR ?? join(process.cwd(), 'data/key-facts'));
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? yamlFiles(join(dir, d.name)) : d.name.endsWith('.yaml') ? [join(dir, d.name)] : [],
  );
}

export class KeyFactsApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyFactsApprovalError';
  }
}

type LessonNode = { lesson_id: string; objectives?: string[]; facts?: { fact_id: string; statement: string; kind: string; accept: string[]; pages: unknown; locator: string }[] };

export async function approveKeyFactsLesson(actor: Actor, input: { lessonId: string; contentHash: string; today?: string }): Promise<void> {
  const account = await getOwnAccount(actor);
  for (const file of yamlFiles(keyFactsDir())) {
    const doc = parseDocument(readFileSync(file, 'utf8'));
    const lessons = doc.get('lessons');
    if (!(lessons instanceof YAMLSeq)) continue;
    const node = lessons.items.find((item) => item instanceof YAMLMap && item.get('lesson_id') === input.lessonId);
    if (!(node instanceof YAMLMap)) continue;
    const raw = node.toJSON() as LessonNode;
    const hash = keyFactsLessonHash({
      lesson_id: raw.lesson_id,
      objectives: raw.objectives ?? [],
      facts: (raw.facts ?? []).map((f) => ({ ...f, statement: f.statement.trim(), pages: String(f.pages) })) as never,
    });
    if (hash !== input.contentHash) throw new KeyFactsApprovalError('Ý chính của bài đã đổi, mở lại trang để xem bản mới rồi duyệt');
    node.set('approved', doc.createNode({ by: account.email, at: input.today ?? new Date().toISOString().slice(0, 10), content_hash: hash }, { flow: true }));
    writeFileSync(file, doc.toString({ lineWidth: 0 }), 'utf8');
    await markKeyFactsLessonApproved(actor, { lessonId: input.lessonId, contentHash: hash });
    return;
  }
  throw new KeyFactsApprovalError(`Không tìm thấy bài ${input.lessonId} trong ${keyFactsDir()}`);
}
