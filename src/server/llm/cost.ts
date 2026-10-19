import 'server-only';
import { modelSpec } from './model-config';

// Chi phí mỗi lượt gọi tính theo bảng giá trong config/models.yaml (USD / 1 triệu token).
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(model: string, usage: TokenUsage): number {
  const p = modelSpec(model).pricing;
  const total =
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    usage.cacheReadTokens * p.cache_read +
    usage.cacheWriteTokens * p.cache_write;
  return Math.round((total / 1_000_000) * 1e6) / 1e6;
}
