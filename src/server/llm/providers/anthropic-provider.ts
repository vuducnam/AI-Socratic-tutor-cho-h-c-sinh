import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type ContentPart, type LlmProvider, type ProviderRequest, type ProviderResult } from '../llm-types';

// Claude API trực tiếp (SDK chính thức). SDK tự retry 2 lần với 408/409/429/5xx/lỗi kết nối.
// Lưu ý model 5.5: không gửi temperature, không prefill; Opus 5.5 không tắt được thinking.

function toAnthropicContent(content: string | ContentPart[]): Anthropic.ContentBlockParam[] | string {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: part.mediaType, data: part.base64 } },
  );
}

function thinkingParam(request: ProviderRequest): Record<string, unknown> {
  if (request.thinking === 'adaptive') return { thinking: { type: 'adaptive' } };
  if (request.thinkingOffMode === 'between_tools') return { thinking: { type: 'between_tools' } };
  if (request.thinkingOffMode === 'disabled') return { thinking: { type: 'disabled' } };
  return {};
}

// Model hỗ trợ server-side fallback khi bị safety classifier từ chối (skill claude-api: bật mặc định).
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export function buildAnthropicParams(request: ProviderRequest): Record<string, unknown> {
  const lastCached = request.system.map((b) => !!b.cache).lastIndexOf(true);
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system.map((block, i) => ({
      type: 'text',
      text: block.text,
      ...(i === lastCached ? { cache_control: { type: 'ephemeral' } } : {}),
    })),
    messages: request.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
    ...thinkingParam(request),
    output_config: {
      effort: request.effort,
      ...(request.jsonSchema ? { format: { type: 'json_schema', schema: request.jsonSchema } } : {}),
    },
    ...(SERVER_FALLBACK_MODELS.has(request.model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
      : {}),
  };
}

function classify(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    const message = err.message ?? 'Anthropic API error';
    if (status === 401 || status === 403) return new ProviderError('anthropic', 'auth', message, status);
    if (status === 402 || /credit|billing|quota|balance/i.test(message)) return new ProviderError('anthropic', 'credit', message, status);
    if (status === 429) return new ProviderError('anthropic', 'rate_limit', message, status);
    if (status === 529) return new ProviderError('anthropic', 'overloaded', message, status);
    if (status !== undefined && status >= 500) return new ProviderError('anthropic', 'server', message, status);
    if (status === undefined) return new ProviderError('anthropic', 'network', message);
    return new ProviderError('anthropic', 'invalid', message, status);
  }
  return new ProviderError('anthropic', 'network', err instanceof Error ? err.message : String(err));
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(options: { apiKey: string; workspaceId?: string; baseURL?: string; fetch?: typeof fetch }) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: 2,
      // Key không gắn workspace phải gửi kèm id workspace.
      ...(options.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': options.workspaceId } } : {}),
    });
  }

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = (await this.client.beta.messages.create(
        buildAnthropicParams(request) as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming,
      )) as Anthropic.Beta.BetaMessage;
    } catch (err) {
      throw classify(err);
    }
    if (message.stop_reason === 'refusal') {
      throw new ProviderError('anthropic', 'refusal', 'Model từ chối yêu cầu', 200, message);
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      raw: message,
      servedModel: message.model,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
