import 'server-only';
import { lifeContextContentHash, LifeContextSeedError, type LifeContextDef } from '@/server/domain/life-context/life-context-schema';
import type { Actor } from '../actor';
import type { AuthorizationFixture } from '../authorization-fixtures';
import { prisma } from '../client';
import { assertSystem } from '../role-guards';

// Seed thư viện tình huống. Trạng thái duyệt đi theo YAML: approved.content_hash phải khớp hash nội dung
// hiện tại, sai (mẫu đã sửa sau khi duyệt) → seed như chưa duyệt. approved.by (email) → users.id.

export async function seedLifeContexts(actor: Actor, contexts: LifeContextDef[]): Promise<{ total: number; approved: number; staleApprovals: string[] }> {
  assertSystem(actor);
  const emails = [...new Set(contexts.flatMap((c) => (c.approved ? [c.approved.by.toLowerCase()] : [])))];
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  const idByEmail = new Map(users.map((u) => [u.email, u.id]));
  const missing = emails.filter((e) => !idByEmail.has(e));
  if (missing.length) throw new LifeContextSeedError(missing.map((e) => `approved.by ${e} không phải tài khoản có thật`));

  let approved = 0;
  const staleApprovals: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const c of contexts) {
      const hash = lifeContextContentHash(c);
      const valid = c.approved && c.approved.content_hash === hash;
      if (c.approved && !valid) staleApprovals.push(c.id);
      if (valid) approved += 1;
      const data = {
        skill_id: c.skill_id,
        theme: c.theme,
        template: c.template,
        min_grade: c.min_grade,
        max_grade: c.max_grade,
        safety: c.safety,
        content_hash: hash,
        approved_by: valid ? idByEmail.get(c.approved!.by.toLowerCase())! : null,
        approved_at: valid ? new Date(c.approved!.at) : null,
      };
      await tx.lifeContext.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
    }
  });
  return { total: contexts.length, approved, staleApprovals };
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  seedLifeContexts: { kind: 'system-only', call: (a) => seedLifeContexts(a, []) },
};
