import 'server-only';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import type { Actor } from '@/server/dal/actor';
import { markLifeContextApproved } from '@/server/dal/life-contexts-dal';
import { getOwnAccount } from '@/server/dal/users-dal';
import { lifeContextContentHash, lifeContextSchema } from './life-context-schema';

// Duyệt tình huống trong /parent › Duyệt: ghi trạng thái duyệt NGƯỢC vào YAML (approved: {by, at,
// content_hash}) để seed ở DB khác (eval, prod) mang theo, rồi cập nhật DB (phase 06, 13).
// Hash trong YAML phải khớp hash phụ huynh đang xem; mẫu đổi sau khi duyệt thì mất duyệt.

export function lifeContextsDir(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.LIFE_CONTEXTS_DIR ?? join(process.cwd(), 'data/life-contexts'));
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? yamlFiles(join(dir, d.name)) : d.name.endsWith('.yaml') ? [join(dir, d.name)] : [],
  );
}

export class LifeContextApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifeContextApprovalError';
  }
}

export async function approveLifeContext(actor: Actor, input: { id: string; contentHash: string; today?: string }): Promise<void> {
  const account = await getOwnAccount(actor);
  for (const file of yamlFiles(lifeContextsDir())) {
    const doc = parseDocument(readFileSync(file, 'utf8'));
    const contexts = doc.get('contexts');
    if (!(contexts instanceof YAMLSeq)) continue;
    const node = contexts.items.find((item) => item instanceof YAMLMap && item.get('id') === input.id);
    if (!(node instanceof YAMLMap)) continue;
    const parsed = lifeContextSchema.parse(node.toJSON());
    const hash = lifeContextContentHash(parsed);
    if (hash !== input.contentHash) throw new LifeContextApprovalError('Nội dung tình huống đã đổi, mở lại trang để xem bản mới rồi duyệt');
    node.set('approved', doc.createNode({ by: account.email, at: input.today ?? new Date().toISOString().slice(0, 10), content_hash: hash }, { flow: true }));
    writeFileSync(file, doc.toString({ lineWidth: 0 }), 'utf8');
    await markLifeContextApproved(actor, { id: input.id, contentHash: hash });
    return;
  }
  throw new LifeContextApprovalError(`Không tìm thấy tình huống ${input.id} trong ${lifeContextsDir()}`);
}
