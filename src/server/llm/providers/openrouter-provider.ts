import 'server-only';
import { modelSpec } from '../model-config';
import { ProviderError, type ContentPart, type LlmProvider, type ProviderRequest, type ProviderResult } from '../llm-types';

// Dự phòng: cùng model Claude qua OpenRouter (API dạng chat completions). Chỉ route tới provider không
// lưu/train dữ liệu (data_collection: deny, SPEC §14).

function toOpenRouterContent(content: string | ContentPart[]) {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.base64}` } },
  );
}

export function buildOpenRouterBody(request: ProviderRequest): Record<string, unknown> {
  const lastCached = request.system.map((b) => !!b.cache).lastIndexOf(true);
  const systemContent = request.system.map((block, i) => ({
    type: 'text',
    text: block.text,
    ...(i === lastCached ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
  return {
    model: modelSpec(request.model).openrouter_slug,
    max_tokens: request.maxTokens,
    messages: [
      { role: 'system', content: systemContent },
      ...request.messages.map((m) => ({ role: m.role, content: toOpenRouterContent(m.content) })),
    ],
    reasoning: request.thinking === 'adaptive' ? { effort: request.effort } : { effort: request.effort, exclude: true },
    ...(request.jsonSchema
      ? { response_format: { type: 'json_schema', json_schema: { name: 'output', strict: true, schema: request.jsonSchema } } }
      : {}),
    provider: { data_collection: 'deny', allow_fallbacks: true },
    usage: { include: true },
  };
}

interface OpenRouterResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
  error?: { code?: number; message?: string };
}

export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter' as const;

  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }) {}

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    const fetchImpl = this.options.fetch ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json', 'x-title': 'Cu tutor' },
        body: JSON.stringify(buildOpenRouterBody(request)),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
      });
    } catch (err) {
      throw new ProviderError('openrouter', 'network', err instanceof Error ? err.message : String(err));
    }
    const data = (await res.json().catch(() => ({}))) as OpenRouterResponse;
    if (!res.ok || data.error) {
      const status = res.ok ? (data.error?.code ?? 500) : res.status;
      const message = data.error?.message ?? `OpenRouter HTTP ${status}`;
      const kind =
        status === 402 ? 'credit' : status === 429 ? 'rate_limit' : status === 401 || status === 403 ? 'auth' : status >= 500 ? 'server' : 'invalid';
      throw new ProviderError('openrouter', kind, message, status, data);
    }
    const text = data.choices?.[0]?.message?.content ?? '';
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const cacheWrite = data.usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
    return {
      text,
      raw: data,
      servedModel: data.model ?? request.model,
      usage: {
        inputTokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached - cacheWrite),
        outputTokens: data.usage?.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: cacheWrite,
      },
    };
  }
}
