import 'server-only';
import { z } from 'zod';
import { defaultLlmCallRecorder, monthLiveSpendUsd, type LlmCallRecorder, type LlmCallRow } from '@/server/dal/llm-calls-dal';
import { raiseSystemAlert } from '@/server/dal/system-alerts-dal';
import { costUsd } from './cost';
import { loadModelsConfig, roleConfig } from './model-config';
import { ProviderError, type ChatMessage, type LlmProvider, type ProviderRequest, type SystemBlock } from './llm-types';
import { AnthropicProvider } from './providers/anthropic-provider';
import { OpenRouterProvider } from './providers/openrouter-provider';

// LlmGateway: điểm gọi model DUY NHẤT (SPEC §2.1, CLAUDE.md › Quy ước code chung).
// Thứ tự: Claude API trực tiếp (SDK retry 2 lần) → lỗi credit/quota/5xx → cùng model qua OpenRouter →
// vẫn lỗi → LlmUnavailableError (UI hiện câu thân thiện, có system_alert). Mọi lần gọi (kể cả lỗi, kể cả
// fallback) ghi llm_calls TRƯỚC khi trả kết quả. Output JSON validate bằng zod; sai → gọi lại 1 lần.
// Chế độ eval: key và trần chi phí riêng, KHÔNG BAO GIỜ fallback OpenRouter.

/** purpose liên quan học sinh: bắt buộc studentId (khớp CHECK llm_calls_student_required_check). */
export const STUDENT_PURPOSES = [
  'tutor',
  'guard',
  'presolve',
  'ocr',
  'hook',
  'contextualize',
  'transfer',
  'learner_summary',
  'report_narrative',
  'mission_extract',
  'stt',
] as const;

export class LlmUnavailableError extends Error {
  readonly friendlyMessage = 'Cú đang mệt, con thử lại sau nhé.';
  constructor(readonly causes: ProviderError[]) {
    super(`LLM không khả dụng: ${causes.map((c) => `${c.provider}:${c.kind}`).join(', ')}`);
    this.name = 'LlmUnavailableError';
  }
}

export class LlmOutputInvalidError extends Error {
  constructor(readonly llmCallIds: string[], readonly lastText: string) {
    super('Output của model không đúng schema sau 2 lần');
    this.name = 'LlmOutputInvalidError';
  }
}

export class EvalBudgetExceededError extends Error {
  constructor(readonly spentUsd: number, readonly capUsd: number) {
    super(`Eval vượt trần chi phí: ${spentUsd.toFixed(2)} / ${capUsd.toFixed(2)} USD`);
    this.name = 'EvalBudgetExceededError';
  }
}

export interface LlmCallRequest<T> {
  /** Vai trò trong config/models.yaml (tutor, guard, presolve…); mặc định trùng purpose. */
  role?: string;
  purpose: string;
  studentId?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  promptVersion: string;
  system: SystemBlock[];
  messages: ChatMessage[];
  responseSchema?: z.ZodType<T>;
  mode?: 'live' | 'eval';
  /** Ghi llm_calls vào transaction của lượt hội thoại (turns-dal); mặc định ghi thẳng. */
  recorder?: LlmCallRecorder;
}

export interface LlmCallResult<T> {
  text: string;
  parsed: T | undefined;
  llmCallId: string;
  /** Mọi dòng llm_calls của lượt gọi này (lỗi, fallback, gọi lại vì sai schema). */
  llmCallIds: string[];
  provider: 'anthropic' | 'openrouter';
  model: string;
  costUsd: number;
}

export interface GatewayDependencies {
  primary?: LlmProvider;
  fallback?: LlmProvider | null;
  evalPrimary?: LlmProvider;
}

// ───────────────────────── JSON Schema cho structured output ─────────────────────────

/** zod → JSON Schema, mọi object có additionalProperties: false (yêu cầu của structured output). */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as Record<string, unknown>;
    if (obj.type === 'object' && obj.properties) obj.additionalProperties = false;
    Object.values(obj).forEach(visit);
  };
  visit(json);
  delete json.$schema;
  return json;
}

/** Bỏ chú thích ```json nếu model lỡ bọc, rồi JSON.parse. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(trimmed);
}

// ───────────────────────── Eval budget ─────────────────────────

let evalSpentUsd = 0;
export function resetEvalBudget(): void {
  evalSpentUsd = 0;
}
export function evalSpent(): number {
  return evalSpentUsd;
}
function evalCapUsd(): number {
  return Number(process.env.EVAL_COST_CAP_USD ?? '20');
}

// ───────────────────────── Gateway ─────────────────────────

function defaultProviders(): Required<GatewayDependencies> {
  const config = loadModelsConfig();
  const key = (env: string) => process.env[env] ?? '';
  return {
    primary: new AnthropicProvider({
      apiKey: key(config.providers.anthropic.api_key_env),
      workspaceId: process.env[config.providers.anthropic.workspace_id_env] || undefined,
    }),
    fallback: key(config.providers.openrouter.api_key_env)
      ? new OpenRouterProvider({ apiKey: key(config.providers.openrouter.api_key_env), baseUrl: config.providers.openrouter.base_url })
      : null,
    evalPrimary: new AnthropicProvider({
      apiKey: key(config.providers.anthropic.eval_api_key_env),
      workspaceId: process.env[config.providers.anthropic.eval_workspace_id_env] || undefined,
    }),
  };
}

let dependencies: GatewayDependencies = {};
/** Chỉ cho test: thay provider (giả lập lỗi ở tầng HTTP qua fetch của provider thật). */
export function setGatewayDependencies(deps: GatewayDependencies): void {
  dependencies = deps;
}

/** Bản ghi request trong llm_calls: đầy đủ, nhưng ảnh có sourceUri thì ghi URI thay cho base64. */
function recordableRequest(request: ProviderRequest, providerName: string): unknown {
  return {
    provider: providerName,
    model: request.model,
    max_tokens: request.maxTokens,
    effort: request.effort,
    thinking: request.thinking,
    system: request.system,
    messages: request.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) =>
              p.type === 'image' ? { type: 'image', mediaType: p.mediaType, source: p.sourceUri ?? `[base64 ${p.base64.length} ký tự]` } : p,
            ),
    })),
    json_schema: request.jsonSchema ?? null,
  };
}

async function checkMonthlyBudget(): Promise<void> {
  const config = loadModelsConfig();
  const spent = await monthLiveSpendUsd();
  if (spent >= config.monthly_budget_usd * config.budget_alert_ratio) {
    const month = new Date().toISOString().slice(0, 7);
    await raiseSystemAlert({
      type: 'credit_80_percent',
      severity: 'warning',
      detail: { month, spent_usd: Number(spent.toFixed(2)), budget_usd: config.monthly_budget_usd },
      dedupeKey: `credit80:${month}`,
    });
  }
}

export async function callLlm<T = unknown>(req: LlmCallRequest<T>): Promise<LlmCallResult<T>> {
  const mode = req.mode ?? 'live';
  if ((STUDENT_PURPOSES as readonly string[]).includes(req.purpose) && !req.studentId) {
    throw new Error(`purpose ${req.purpose} bắt buộc studentId`);
  }
  if (mode === 'eval' && evalSpentUsd >= evalCapUsd()) throw new EvalBudgetExceededError(evalSpentUsd, evalCapUsd());

  const role = roleConfig(req.role ?? req.purpose);
  const defaults = defaultProviders();
  const primary = mode === 'eval' ? (dependencies.evalPrimary ?? defaults.evalPrimary) : (dependencies.primary ?? defaults.primary);
  const fallback = mode === 'eval' ? null : dependencies.fallback === undefined ? defaults.fallback : dependencies.fallback;
  const recorder = req.recorder ?? defaultLlmCallRecorder;

  const providerRequest: ProviderRequest = {
    model: role.model,
    system: req.system,
    messages: req.messages,
    maxTokens: role.max_tokens,
    effort: role.effort,
    thinking: role.thinking,
    thinkingOffMode: role.spec.thinking_off_mode,
    jsonSchema: req.responseSchema ? toStrictJsonSchema(req.responseSchema) : undefined,
  };

  const callIds: string[] = [];
  const base = {
    studentId: req.studentId ?? null,
    sessionId: req.sessionId ?? null,
    turnId: req.turnId ?? null,
    purpose: req.purpose,
    mode,
    model: role.model,
    promptVersion: req.promptVersion,
  } satisfies Partial<LlmCallRow>;

  // Một lần gọi tới một provider, luôn ghi llm_calls (thành công hoặc lỗi).
  const attempt = async (provider: LlmProvider) => {
    const started = Date.now();
    try {
      const result = await provider.complete(providerRequest);
      const cost = costUsd(role.model, result.usage);
      if (mode === 'eval') evalSpentUsd += cost;
      const id = await recorder.append({
        ...base,
        provider: provider.name,
        request: recordableRequest(providerRequest, provider.name),
        response: result.raw,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheWriteTokens: result.usage.cacheWriteTokens,
        costUsd: cost,
        latencyMs: Date.now() - started,
        error: null,
      });
      callIds.push(id);
      return { ok: true as const, result, id, cost, provider: provider.name };
    } catch (err) {
      const error = err instanceof ProviderError ? err : new ProviderError(provider.name, 'network', String(err));
      const id = await recorder.append({
        ...base,
        provider: provider.name,
        request: recordableRequest(providerRequest, provider.name),
        response: (error.raw as object | undefined) ?? null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        costUsd: null,
        latencyMs: Date.now() - started,
        error: `${error.kind}${error.status ? ` ${error.status}` : ''}: ${error.message}`.slice(0, 2000),
      });
      callIds.push(id);
      return { ok: false as const, error };
    }
  };

  // Primary → fallback (chỉ live, chỉ lỗi đủ điều kiện).
  const completeOnce = async () => {
    const first = await attempt(primary);
    if (first.ok) return first;
    const causes = [first.error];
    if (fallback && first.error.fallbackEligible) {
      const second = await attempt(fallback);
      if (second.ok) return second;
      causes.push(second.error);
    }
    await raiseSystemAlert({
      type: 'llm_gateway_failure',
      severity: 'high',
      detail: { purpose: req.purpose, causes: causes.map((c) => `${c.provider}:${c.kind}:${c.status ?? ''}`) },
    });
    throw new LlmUnavailableError(causes);
  };

  let outcome = await completeOnce();
  let parsed: T | undefined;
  if (req.responseSchema) {
    const tryParse = (text: string) => {
      try {
        const r = req.responseSchema!.safeParse(parseJsonText(text));
        return r.success ? { ok: true as const, value: r.data } : { ok: false as const };
      } catch {
        return { ok: false as const };
      }
    };
    let p = tryParse(outcome.result.text);
    if (!p.ok) {
      // Parse fail → gọi lại 1 lần (quy ước code chung); vẫn sai → lỗi để nơi gọi dùng câu dự phòng.
      outcome = await completeOnce();
      p = tryParse(outcome.result.text);
      if (!p.ok) throw new LlmOutputInvalidError([...callIds], outcome.result.text);
    }
    parsed = p.value;
  }

  if (mode === 'live') await checkMonthlyBudget().catch(() => undefined);

  return {
    text: outcome.result.text,
    parsed,
    llmCallId: outcome.id,
    llmCallIds: [...callIds],
    provider: outcome.provider,
    model: role.model,
    costUsd: outcome.cost,
  };
}
