import 'dotenv/config';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillFile, SkillSeedError, type SkillDefinition } from '@/server/domain/curriculum/skill-yaml-schema';
import { seedSkills } from '@/server/dal/seed/seed-skills';
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

async function main() {
  await seedSkillGraph();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof SkillSeedError ? err.message : err);
    process.exit(1);
  });
