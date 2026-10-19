import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { defaultLlmCallRecorder } from '@/server/dal/llm-calls-dal';
import { costUsd } from './cost';
import { loadModelsConfig, roleConfig } from './model-config';
import { buildAnthropicParams } from './providers/anthropic-provider';
import { STUDENT_PURPOSES, toStrictJsonSchema } from './llm-gateway';
import type { ChatMessage, SystemBlock } from './llm-types';
import type { z } from 'zod';

// Message Batches API cho việc offline không tương tác (nháp misconception, báo cáo tuần — Giai đoạn 1).
// Chạy trong worker: gửi batch, chờ xong, mỗi item ghi một dòng llm_calls. Batch không có fallback
// OpenRouter (không cần trả lời ngay; lỗi thì job BullMQ retry).

export interface BatchItem {
  customId: string;
  role?: string;
  purpose: string;
  studentId?: string | null;
  promptVersion: string;
  system: SystemBlock[];
  messages: ChatMessage[];
  responseSchema?: z.ZodType;
}

export interface BatchItemResult {
  customId: string;
  ok: boolean;
  text: string;
  llmCallId: string;
}

export async function callBatch(
  items: BatchItem[],
  options: { pollMs?: number; timeoutMs?: number; client?: Anthropic } = {},
): Promise<BatchItemResult[]> {
  for (const item of items) {
    if ((STUDENT_PURPOSES as readonly string[]).includes(item.purpose) && !item.studentId) {
      throw new Error(`purpose ${item.purpose} bắt buộc studentId`);
    }
  }
  const config = loadModelsConfig();
  const workspaceId = process.env[config.providers.anthropic.workspace_id_env];
  const client =
    options.client ??
    new Anthropic({
      apiKey: process.env[config.providers.anthropic.api_key_env] ?? '',
      ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
    });

  const prepared = items.map((item) => {
    const role = roleConfig(item.role ?? item.purpose);
    const params = buildAnthropicParams({
      model: role.model,
      system: item.system,
      messages: item.messages,
      maxTokens: role.max_tokens,
      effort: role.effort,
      thinking: role.thinking,
      thinkingOffMode: role.spec.thinking_off_mode,
      jsonSchema: item.responseSchema ? toStrictJsonSchema(item.responseSchema) : undefined,
    });
    // Batches không nhận tham số beta fallbacks.
    delete params.betas;
    delete params.fallbacks;
    return { item, role, params };
  });

  const batch = await client.messages.batches.create({
    requests: prepared.map((p) => ({
      custom_id: p.item.customId,
      params: p.params as unknown as Anthropic.MessageCreateParamsNonStreaming,
    })),
  });

  const started = Date.now();
  let status = batch;
  while (status.processing_status !== 'ended') {
    if (Date.now() - started > (options.timeoutMs ?? 24 * 3600_000)) throw new Error(`Batch ${batch.id} quá hạn chờ`);
    await new Promise((r) => setTimeout(r, options.pollMs ?? 60_000));
    status = await client.messages.batches.retrieve(batch.id);
  }

  const byId = new Map(prepared.map((p) => [p.item.customId, p]));
  const results: BatchItemResult[] = [];
  for await (const entry of await client.messages.batches.results(batch.id)) {
    const p = byId.get(entry.custom_id);
    if (!p) continue;
    const ok = entry.result.type === 'succeeded';
    const message = entry.result.type === 'succeeded' ? entry.result.message : null;
    const text = message
      ? message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      : '';
    const usage = message
      ? {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        }
      : null;
    const llmCallId = await defaultLlmCallRecorder.append({
      studentId: p.item.studentId ?? null,
      sessionId: null,
      turnId: null,
      purpose: p.item.purpose,
      mode: 'live',
      provider: 'anthropic-batch',
      model: p.role.model,
      promptVersion: p.item.promptVersion,
      request: { batch_id: batch.id, custom_id: entry.custom_id, ...p.params },
      response: entry.result as unknown as object,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      cacheReadTokens: usage?.cacheReadTokens ?? null,
      cacheWriteTokens: usage?.cacheWriteTokens ?? null,
      // Batch giảm 50% giá.
      costUsd: usage ? costUsd(p.role.model, usage) / 2 : null,
      latencyMs: Date.now() - started,
      error: ok ? null : entry.result.type,
    });
    results.push({ customId: entry.custom_id, ok, text, llmCallId });
  }
  return results;
}
