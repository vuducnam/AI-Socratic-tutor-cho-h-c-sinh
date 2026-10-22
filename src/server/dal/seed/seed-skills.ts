import 'server-only';
import { misconceptionDbId, SkillSeedError, type SkillDefinition } from '@/server/domain/curriculum/skill-yaml-schema';
import type { Actor } from '../actor';
import type { AuthorizationFixture } from '../authorization-fixtures';
import { prisma } from '../client';
import { assertSystem } from '../role-guards';

// Ghi skill graph vào `skills` + `misconceptions` (upsert: seed lại không nhân đôi). approved.by (email)
// đổi thành users.id; email không phải tài khoản có thật → lỗi rõ ràng (chạy create-first-admin trước).

export async function seedSkills(actor: Actor, skills: SkillDefinition[]): Promise<{ skills: number; misconceptions: number }> {
  assertSystem(actor);
  const emails = [...new Set(skills.flatMap((s) => s.misconceptions.map((m) => m.approved.by.toLowerCase())))];
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  const idByEmail = new Map(users.map((u) => [u.email, u.id]));
  const missing = emails.filter((e) => !idByEmail.has(e));
  if (missing.length) {
    throw new SkillSeedError(missing.map((e) => `approved.by ${e} không phải tài khoản có thật (chạy pnpm admin:create trước)`));
  }

  let misconceptionCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const skill of skills) {
      const data = {
        subject: skill.subject,
        grade_introduced: skill.grade_introduced,
        name: skill.name,
        prerequisites: skill.prerequisites,
        leads_to: skill.leads_to,
        source: skill.source,
      };
      await tx.skill.upsert({ where: { skill_id: skill.skill_id }, create: { skill_id: skill.skill_id, ...data }, update: data });
      for (const m of skill.misconceptions) {
        const row = {
          skill_id: skill.skill_id,
          description: m.description,
          probe: m.probe ?? null,
          approved_by: idByEmail.get(m.approved.by.toLowerCase())!,
          approved_at: new Date(m.approved.at),
        };
        const id = misconceptionDbId(skill.skill_id, m.id);
        await tx.misconception.upsert({ where: { id }, create: { id, ...row }, update: row });
        misconceptionCount += 1;
      }
    }
  });
  return { skills: skills.length, misconceptions: misconceptionCount };
}

export async function listSkillIds(actor: Actor): Promise<string[]> {
  assertSystem(actor);
  return (await prisma.skill.findMany({ select: { skill_id: true } })).map((s) => s.skill_id);
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  seedSkills: { kind: 'system-only', call: (a) => seedSkills(a, []) },
  listSkillIds: { kind: 'system-only', call: (a) => listSkillIds(a) },
};
