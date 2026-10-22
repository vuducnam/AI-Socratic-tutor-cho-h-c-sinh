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
  // STT: local trên PC là chính; cloud chỉ là dự phòng khi phụ huynh bật (quy tắc cứng 10).
  stt: z.object({
    local_url_env: z.string().min(1),
    local_models: z.object({ vi: z.string().min(1), en: z.string().min(1) }),
    cloud_fallback: z.string().min(1),
    cloud_candidates: z.array(z.string().min(1)).min(1),
    cloud_pricing_usd_per_second: z.record(z.string(), z.number().nonnegative()),
    max_seconds: z.number().int().positive(),
    max_bytes: z.number().int().positive(),
  }),
  tts: z.object({
    model: z.string().min(1),
    // Gemini TTS qua OpenRouter chỉ trả PCM; server bọc thành WAV (src/server/voice/pcm-to-wav.ts).
    response_format: z.literal('pcm'),
    default_voice: z.string().min(1),
    // Chỉ dẫn phong cách đọc gửi kèm `instructions` (giọng miền, nhịp, cảm xúc); không bị đọc to.
    style_instructions: z.string().max(500).optional(),
  }),
});

export type ModelsConfig = z.infer<typeof configSchema>;
export type RoleConfig = ModelsConfig['roles'][string];
export type ModelSpec = ModelsConfig['models'][string];
export type SttConfig = ModelsConfig['stt'];
export type TtsConfig = ModelsConfig['tts'];

let cached: ModelsConfig | undefined;

export function loadModelsConfig(path = resolve(/*turbopackIgnore: true*/ process.cwd(), 'config/models.yaml')): ModelsConfig {
  if (cached) return cached;
  const config = configSchema.parse(parse(readFileSync(path, 'utf8')));
  for (const [role, r] of Object.entries(config.roles)) {
    if (!config.models[r.model]) throw new Error(`config/models.yaml: vai trò ${role} dùng model chưa khai báo ${r.model}`);
  }
  if (!config.stt.cloud_candidates.includes(config.stt.cloud_fallback)) {
    throw new Error(`config/models.yaml: stt.cloud_fallback ${config.stt.cloud_fallback} không nằm trong stt.cloud_candidates`);
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

export function sttConfig(): SttConfig {
  return loadModelsConfig().stt;
}

export function ttsConfig(): TtsConfig {
  return loadModelsConfig().tts;
}

export function openRouterConfig(): ModelsConfig['providers']['openrouter'] {
  return loadModelsConfig().providers.openrouter;
}
