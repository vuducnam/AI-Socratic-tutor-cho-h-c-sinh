import 'server-only';
import { parse } from 'yaml';
import { z } from 'zod';

// Skill graph YAML: data/skills/<subject>/grade<N>.yaml (SPEC §5, quy tắc cứng 6).
// - Skill thiếu source.official_url hoặc source.lesson → từ chối, báo rõ file, skill_id, trường thiếu.
// - Misconception (kể cả do Claude nháp) chỉ được seed khi TỪNG mục có approved: {by: <email>, at: <ngày>}
//   do chủ dự án ghi sau khi đọc. Thiếu → từ chối. Trạng thái duyệt đi theo dữ liệu, không theo DB.

const dateLike = z.union([z.iso.date(), z.date().transform((d) => d.toISOString().slice(0, 10))]);

export const skillSourceSchema = z.object({
  series: z.string().min(1),
  publisher: z.string().min(1),
  book: z.string().min(1),
  lesson: z.string().min(1),
  pages: z.union([z.string(), z.number()]).transform(String).optional(),
  official_url: z.url().refine((u) => new URL(u).hostname === 'taphuan.nxbgd.vn', {
    message: 'chỉ nhận bản đọc chính thống taphuan.nxbgd.vn (quy tắc cứng 6)',
  }),
  imported_at: dateLike,
});

const approvalSchema = z.object({ by: z.email(), at: dateLike });

export const misconceptionSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'id viết HOA_GẠCH_DƯỚI'),
  description: z.string().min(1),
  probe: z.string().min(1).optional(),
  approved: approvalSchema,
});

export const skillSchema = z.object({
  skill_id: z.string().regex(/^[A-Z]+(\.[A-Z0-9_]+)+$/, 'skill_id dạng MATH.DECIMAL.COMPARE'),
  name: z.string().min(1),
  subject: z.string().min(1),
  grade_introduced: z.number().int().min(1).max(12),
  prerequisites: z.array(z.string()).default([]),
  leads_to: z.array(z.string()).default([]),
  misconceptions: z.array(misconceptionSchema).default([]),
  source: skillSourceSchema,
});

export const skillFileSchema = z.object({
  subject: z.string().min(1),
  grade: z.number().int().min(1).max(12),
  skills: z.array(z.unknown()),
});

export type SkillDefinition = z.infer<typeof skillSchema>;

export class SkillSeedError extends Error {
  constructor(readonly problems: string[]) {
    super(`Seed skill bị từ chối:\n- ${problems.join('\n- ')}`);
    this.name = 'SkillSeedError';
  }
}

function describeIssues(file: string, skillId: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => `${file} › ${skillId} › ${issue.path.join('.') || '(gốc)'}: ${issue.message}`);
}

/** id misconception trong DB: "<skill_id>.<id>" (id trong YAML chỉ duy nhất trong một skill). */
export function misconceptionDbId(skillId: string, localId: string): string {
  return `${skillId}.${localId}`;
}

/** Đọc và kiểm một file skill; ném SkillSeedError liệt kê MỌI lỗi (không dừng ở lỗi đầu). */
export function parseSkillFile(file: string, text: string): SkillDefinition[] {
  const top = skillFileSchema.safeParse(parse(text));
  if (!top.success) throw new SkillSeedError(describeIssues(file, '(file)', top.error));

  const problems: string[] = [];
  const skills: SkillDefinition[] = [];
  const seen = new Set<string>();
  top.data.skills.forEach((raw, index) => {
    const skillId = (raw as { skill_id?: unknown })?.skill_id;
    const label = typeof skillId === 'string' ? skillId : `skills[${index}]`;
    const result = skillSchema.safeParse(raw);
    if (!result.success) {
      problems.push(...describeIssues(file, label, result.error));
      return;
    }
    const skill = result.data;
    if (seen.has(skill.skill_id)) problems.push(`${file} › ${skill.skill_id}: skill_id trùng`);
    seen.add(skill.skill_id);
    if (skill.subject !== top.data.subject) problems.push(`${file} › ${skill.skill_id}: subject khác subject của file`);
    const ids = skill.misconceptions.map((m) => m.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) problems.push(`${file} › ${skill.skill_id} › misconceptions: id trùng ${dup}`);
    skills.push(skill);
  });
  if (problems.length) throw new SkillSeedError(problems);
  return skills;
}
