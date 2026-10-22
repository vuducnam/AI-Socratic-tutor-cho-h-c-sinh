import 'server-only';
import { loadModelsConfig } from '@/server/llm/model-config';

// Gọi endpoint audio của OpenRouter (/audio/transcriptions, /audio/speech) bằng fetch. Key và base_url
// lấy theo config/models.yaml › providers.openrouter. Luôn yêu cầu provider không lưu/train dữ liệu.

export class OpenRouterAudioError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly raw: unknown = null,
  ) {
    super(message);
    this.name = 'OpenRouterAudioError';
  }
}

function credentials(): { apiKey: string; baseUrl: string } | null {
  const config = loadModelsConfig().providers.openrouter;
  const apiKey = process.env[config.api_key_env] ?? '';
  return apiKey ? { apiKey, baseUrl: config.base_url.replace(/\/$/, '') } : null;
}

/** Có key OpenRouter trong môi trường hay không (không có thì không thử cloud). */
export function openRouterAudioConfigured(): boolean {
  return credentials() !== null;
}

/** Chính sách dữ liệu gửi kèm mọi request audio (SPEC §14). */
export const OPENROUTER_DATA_POLICY = { data_collection: 'deny' } as const;

/**
 * POST JSON tới `{base_url}{path}`. Lỗi mạng, timeout hoặc HTTP không 2xx → OpenRouterAudioError
 * (kèm body lỗi nếu đọc được). Trả Response 2xx để nơi gọi tự đọc JSON hoặc bytes audio.
 */
export async function postOpenRouterAudio(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  const creds = credentials();
  if (!creds) throw new OpenRouterAudioError('Chưa cấu hình key OpenRouter');
  let res: Response;
  try {
    res = await fetch(`${creds.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${creds.apiKey}`, 'content-type': 'application/json', 'x-title': 'Cu tutor' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new OpenRouterAudioError(`Không gọi được OpenRouter: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => null);
    const message = (raw as { error?: { message?: unknown } } | null)?.error?.message;
    throw new OpenRouterAudioError(typeof message === 'string' ? message : `OpenRouter HTTP ${res.status}`, res.status, raw);
  }
  return res;
}
