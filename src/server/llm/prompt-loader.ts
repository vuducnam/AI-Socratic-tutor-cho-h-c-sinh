import 'server-only';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensurePromptVersion } from '@/server/dal/prompt-versions-dal';

// Prompt nằm trong prompts/<name>/<version>.md, có version; không viết prompt inline (CLAUDE.md).
// Loader ghi prompt_versions (id = "<name>/<version>", kèm sha256). Hash đổi dưới id cũ → lỗi.
// Biến dạng {ten_bien} (chữ, số, gạch dưới, dấu chấm); thiếu biến → lỗi, không để lọt "{...}" ra model.

export interface LoadedPrompt {
  id: string;
  name: string;
  version: string;
  content: string;
  contentHash: string;
}

const loaded = new Map<string, LoadedPrompt>();

export function promptsDir(): string {
  return resolve(/*turbopackIgnore: true*/ process.cwd(), 'prompts');
}

export async function loadPrompt(id: string): Promise<LoadedPrompt> {
  const hit = loaded.get(id);
  if (hit) return hit;
  const match = /^([a-z_]+(?:\/[a-z_]+)*)\/(v\d+)$/.exec(id);
  if (!match) throw new Error(`Prompt id không hợp lệ: ${id} (dạng name/v1)`);
  const [, name, version] = match as unknown as [string, string, string];
  const content = readFileSync(resolve(promptsDir(), name, `${version}.md`), 'utf8').replace(/\r\n/g, '\n');
  const contentHash = createHash('sha256').update(content).digest('hex');
  await ensurePromptVersion({ id, name, content, contentHash });
  const prompt = { id, name, version, content, contentHash };
  loaded.set(id, prompt);
  return prompt;
}

const VARIABLE = /\{([A-Za-z_][A-Za-z0-9_.]*)\}/g;

export function renderPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(VARIABLE, (whole, key: string) => {
    if (!(key in vars)) throw new Error(`Prompt thiếu biến {${key}}`);
    return String(vars[key]);
  });
}

/** Danh sách biến một template cần (để test prompt không thiếu biến). */
export function promptVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VARIABLE)].map((m) => m[1]!))];
}
