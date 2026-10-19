import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

// Đọc config/models.yaml (model theo vai trò, giá, ngân sách). Không hard-code model trong code.

const effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

const configSchema = z.object({
  monthly_budget_usd: z.number().positive(),
  budget_alert_ratio: z.number().gt(0).lt(1),
  providers: z.object({
    anthropic: z.object({
      api_key_env: z.string(),
      workspace_id_env: z.string(),
      eval_api_key_env: z.string(),
      eval_workspace_id_env: z.string(),
    }),
    openrouter: z.object({ api_key_env: z.string(), base_url: z.url() }),
  }),
  models: z.record(
    z.string(),
    z.object({
      openrouter_slug: z.string(),
      thinking_off_mode: z.enum(['none', 'between_tools', 'disabled']),
      pricing: z.object({ input: z.number(), output: z.number(), cache_write: z.number(), cache_read: z.number() }),
    }),
  ),
  roles: z.record(
    z.string(),
    z.object({
      model: z.string(),
      effort,
      thinking: z.enum(['off', 'adaptive']),
      max_tokens: z.number().int().positive(),
    }),
  ),
});

export type ModelsConfig = z.infer<typeof configSchema>;
export type RoleConfig = ModelsConfig['roles'][string];
export type ModelSpec = ModelsConfig['models'][string];

let cached: ModelsConfig | undefined;

export function loadModelsConfig(path = resolve(/*turbopackIgnore: true*/ process.cwd(), 'config/models.yaml')): ModelsConfig {
  if (cached) return cached;
  const config = configSchema.parse(parse(readFileSync(path, 'utf8')));
  for (const [role, r] of Object.entries(config.roles)) {
    if (!config.models[r.model]) throw new Error(`config/models.yaml: vai trò ${role} dùng model chưa khai báo ${r.model}`);
  }
  cached = config;
  return config;
}

export function roleConfig(role: string): RoleConfig & { spec: ModelSpec } {
  const config = loadModelsConfig();
  const r = config.roles[role];
  if (!r) throw new Error(`config/models.yaml: thiếu vai trò ${role}`);
  return { ...r, spec: config.models[r.model]! };
}

export function modelSpec(model: string): ModelSpec {
  const spec = loadModelsConfig().models[model];
  if (!spec) throw new Error(`config/models.yaml: thiếu model ${model}`);
  return spec;
}
