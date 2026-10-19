import 'server-only';
import type { TokenUsage } from './cost';

// Kiểu chung cho mọi provider (Claude API trực tiếp, OpenRouter). Gateway chỉ làm việc với các kiểu này.

export type ContentPart =
  | { type: 'text'; text: string }
  /** Ảnh đề: `sourceUri` (storage:…) được ghi vào llm_calls thay cho base64 để log gọn mà vẫn truy được ảnh gốc. */
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string; sourceUri?: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

/** Khối system: `cache: true` đặt breakpoint prompt caching sau khối này (phần ổn định trong một bài). */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ProviderRequest {
  model: string;
  system: SystemBlock[];
  messages: ChatMessage[];
  maxTokens: number;
  effort: Effort;
  thinking: 'off' | 'adaptive';
  thinkingOffMode: 'none' | 'between_tools' | 'disabled';
  /** JSON Schema cho structured output (đã chuẩn hoá additionalProperties: false). */
  jsonSchema?: Record<string, unknown>;
}

export interface ProviderResult {
  text: string;
  usage: TokenUsage;
  /** Response thô của provider, ghi nguyên vào llm_calls.response. */
  raw: unknown;
  /** Model thực tế provider báo về. */
  servedModel: string;
}

export type ProviderErrorKind = 'credit' | 'rate_limit' | 'overloaded' | 'server' | 'network' | 'refusal' | 'invalid' | 'auth';

export class ProviderError extends Error {
  constructor(
    readonly provider: 'anthropic' | 'openrouter',
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** Lỗi credit/hết quota/5xx (sau retry của SDK) → được chuyển sang OpenRouter (SPEC §2.1). */
  get fallbackEligible(): boolean {
    return ['credit', 'rate_limit', 'overloaded', 'server', 'network'].includes(this.kind);
  }
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openrouter';
  complete(request: ProviderRequest): Promise<ProviderResult>;
}
