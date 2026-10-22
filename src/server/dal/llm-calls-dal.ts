import 'server-only';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// llm_calls [AO]: chỉ append. LlmGateway ghi mọi lượt gọi (kể cả lỗi, kể cả lần fallback) TRƯỚC khi trả
// kết quả (SPEC §2.1). Lượt gọi thuộc một lượt hội thoại ghi trong cùng transaction với turns
// (turn_id DEFERRABLE) qua `recorder` do turns-dal cung cấp.

export interface LlmCallRow {
  id?: string;
  studentId: string | null;
  sessionId: string | null;
  turnId: string | null;
  purpose: string;
  mode: 'live' | 'eval';
  provider: string;
  model: string;
  promptVersion: string | null;
  request: unknown;
  response: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
}

/** Nơi ghi llm_calls: mặc định ghi thẳng; trong một lượt hội thoại thì ghi trong transaction của lượt. */
export interface LlmCallRecorder {
  append(row: LlmCallRow): Promise<string>;
}

type LlmCallWriter = Pick<typeof prisma, 'llmCall'>;

export async function writeLlmCall(db: LlmCallWriter, row: LlmCallRow): Promise<string> {
  const created = await db.llmCall.create({
    data: {
      ...(row.id ? { id: row.id } : {}),
      student_id: row.studentId,
      session_id: row.sessionId,
      turn_id: row.turnId,
      purpose: row.purpose,
      mode: row.mode,
      provider: row.provider,
      model: row.model,
      prompt_version: row.promptVersion,
      request: (row.request ?? {}) as object,
      response: row.response === undefined || row.response === null ? undefined : (row.response as object),
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      cache_read_tokens: row.cacheReadTokens,
      cache_write_tokens: row.cacheWriteTokens,
      cost_usd: row.costUsd,
      latency_ms: row.latencyMs,
      error: row.error,
    },
    select: { id: true },
  });
  return created.id;
}

export const defaultLlmCallRecorder: LlmCallRecorder = {
  append: (row) => writeLlmCall(prisma, row),
};

/** Tổng chi phí lượt gọi live trong tháng (UTC) để cảnh báo 80% credit. */
export async function monthLiveSpendUsd(now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const agg = await prisma.llmCall.aggregate({
    _sum: { cost_usd: true },
    where: { mode: 'live', created_at: { gte: start } },
  });
  return Number(agg._sum.cost_usd ?? 0);
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  writeLlmCall: { kind: 'no-actor', reason: 'chỉ ghi (append-only) từ LlmGateway; quyền đã kiểm ở luồng gọi' },
  monthLiveSpendUsd: { kind: 'no-actor', reason: 'tổng chi phí toàn hệ thống, không có dữ liệu học sinh' },
};
