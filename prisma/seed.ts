import 'dotenv/config';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  CurriculumSeedError,
  parseBeyondScopeFile,
  parseCurriculumFile,
  type BeyondScopeTermDef,
  type CurriculumLessonDef,
} from '@/server/domain/curriculum/curriculum-yaml-schema';
import { parseSkillFile, SkillSeedError, type SkillDefinition } from '@/server/domain/curriculum/skill-yaml-schema';
import { seedCurriculum } from '@/server/dal/seed/seed-curriculum';
import { listSkillIds, seedSkills } from '@/server/dal/seed/seed-skills';
import { systemActor } from '../worker/actor';

// pnpm db:seed (không nhận đối số): nạp skill graph từ data/skills/**. Trạng thái duyệt đi theo YAML.
// Dữ liệu thật do chủ dự án nhập từ bản đọc chính thống (phase 00); thiếu file thì bỏ qua và báo.

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? yamlFiles(join(dir, d.name)) : d.name.endsWith('.yaml') ? [join(dir, d.name)] : [],
  );
}

export async function seedSkillGraph(): Promise<SkillDefinition[]> {
  const files = yamlFiles('data/skills');
  if (!files.length) {
    console.warn('[seed] chưa có data/skills/**/*.yaml (phase 00 D3) — bỏ qua skill graph');
    return [];
  }
  const skills = files.flatMap((f) => parseSkillFile(f, readFileSync(f, 'utf8')));
  const result = await seedSkills(systemActor('pnpm db:seed'), skills);
  console.log(`[seed] skill: ${result.skills}, misconception đã duyệt: ${result.misconceptions}`);
  return skills;
}

// Mục lục data/curriculum/<subject>/grade<N>.yaml + thuật ngữ lớp trên beyond-grade<N>.yaml.
export async function seedCurriculumData(skills: SkillDefinition[]): Promise<void> {
  const actor = systemActor('pnpm db:seed');
  const known = new Set([...skills.map((s) => s.skill_id), ...(await listSkillIds(actor))]);
  const lessons: CurriculumLessonDef[] = [];
  const beyondTerms: BeyondScopeTermDef[] = [];
  for (const file of yamlFiles('data/curriculum')) {
    const text = readFileSync(file, 'utf8');
    const name = basename(file);
    if (name.startsWith('beyond-')) {
      beyondTerms.push(...parseBeyondScopeFile(file, text));
      continue;
    }
    const grade = Number(/grade(\d+)\.yaml$/.exec(name)?.[1]);
    const parsed = parseCurriculumFile(file, text, {
      knownSkillIds: known,
      gradeSkillIds: skills.filter((s) => s.grade_introduced === grade && file.includes(`${s.subject}`)).map((s) => s.skill_id),
    });
    const pendingReview = parsed.warnings.filter((w) => w.includes('imported_at'));
    if (pendingReview.length) console.warn(`[seed] ${file}: ${pendingReview.length} bài chưa có imported_at (chờ chủ dự án duyệt)`);
    parsed.warnings.filter((w) => !w.includes('imported_at')).forEach((w) => console.warn(`[seed] cảnh báo: ${w}`));
    lessons.push(...parsed.lessons);
  }
  const result = await seedCurriculum(actor, { lessons, beyondTerms });
  console.log(`[seed] bài: ${result.lessons}, thuật ngữ lớp trên: ${result.beyondTerms}`);
}

async function main() {
  const skills = await seedSkillGraph();
  await seedCurriculumData(skills);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof SkillSeedError || err instanceof CurriculumSeedError ? err.message : err);
    process.exit(1);
  });
