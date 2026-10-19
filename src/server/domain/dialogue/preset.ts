import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

// Preset theo cấp (config/presets/*.yaml, SPEC §4.2): giới hạn độ dài, số câu hỏi, ngưỡng leo thang.
const presetSchema = z.object({
  id: z.string(),
  socratic_intensity: z.enum(['guided', 'challenge', 'elenchus']),
  max_sentences: z.number().int().positive(),
  max_words_per_turn: z.number().int().positive(),
  max_questions_per_turn: z.number().int().positive(),
  max_sentences_situational: z.number().int().positive(),
  session_minutes: z.number().int().positive(),
  daily_limit_minutes: z.number().int().positive(),
  escalation_threshold: z.number().int().positive(),
});

export type Preset = z.infer<typeof presetSchema>;

const cache = new Map<string, Preset>();

export function loadPreset(id: string): Preset {
  const hit = cache.get(id);
  if (hit) return hit;
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`preset không hợp lệ: ${id}`);
  const preset = presetSchema.parse(
    parse(readFileSync(resolve(/*turbopackIgnore: true*/ process.cwd(), 'config/presets', `${id}.yaml`), 'utf8')),
  );
  cache.set(id, preset);
  return preset;
}
