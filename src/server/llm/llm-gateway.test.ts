import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { appDb, closeTestDatabases } from '../../../tests/helpers/test-database';
import { seedStudentEverywhere } from '../../../tests/helpers/seed-student-everywhere';
import {
  callLlm,
  EvalBudgetExceededError,
  LlmUnavailableError,
  resetEvalBudget,
  setGatewayDependencies,
  toStrictJsonSchema,
} from './llm-gateway';
import { AnthropicProvider } from './providers/anthropic-provider';
import { OpenRouterProvider } from './providers/openrouter-provider';
import { loadPrompt, renderPrompt } from './prompt-loader';

// SPEC §15.4: mock lỗi credit (stub ở tầng HTTP, không ở gateway) → gọi được qua OpenRouter, có 2 dòng llm_calls.

afterEach(() => {
  setGatewayDependencies({});
  resetEvalBudget();
});
afterAll(closeTestDatabases);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });

const anthropicMessage = (text: string) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
});

function anthropicFetch(responses: Response[]) {
  const calls: unknown[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const next = responses.shift();
    if (!next) throw new Error('hết response giả');
    return next;
  }) as unknown as typeof fetch;
  return { provider: new AnthropicProvider({ apiKey: 'test', baseURL: 'http://anthropic.test', fetch: fetchImpl }), calls };
}

function openRouterFetch(responses: Response[]) {
  const calls: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return responses.shift()!;
  }) as unknown as typeof fetch;
  return { provider: new OpenRouterProvider({ apiKey: 'test', baseUrl: 'http://openrouter.test/api/v1', fetch: fetchImpl }), calls };
}

const creditError = () =>
  json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } });

async function rowsFor(ids: string[]) {
  const { rows } = await appDb().query(
    'SELECT id, provider, error, student_id, session_id, cost_usd::float AS cost, input_tokens FROM llm_calls WHERE id = ANY($1) ORDER BY created_at',
    [ids],
  );
  return rows;
}

describe('LlmGateway', () => {
  it('lỗi credit ở Claude API → fallback OpenRouter, cả hai lần đều có dòng llm_calls', async () => {
    const s = await seedStudentEverywhere(appDb());
    const a = anthropicFetch([creditError()]);
    const o = openRouterFetch([
      json(200, {
        model: 'anthropic/claude-sonnet-5.5',
        choices: [{ message: { content: '{"message":"Con thử nghĩ xem?"}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 20 },
      }),
    ]);
    setGatewayDependencies({ primary: a.provider, fallback: o.provider });

    const result = await callLlm({
      purpose: 'tutor',
      studentId: s.studentId,
      sessionId: s.sessionId,
      promptVersion: 'tutor/v1',
      system: [{ text: 'hệ thống', cache: true }],
      messages: [{ role: 'user', content: 'chào Cú' }],
      responseSchema: z.object({ message: z.string() }),
    });

    expect(result.provider).toBe('openrouter');
    expect(result.parsed).toEqual({ message: 'Con thử nghĩ xem?' });
    const rows = await rowsFor(result.llmCallIds);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ provider: 'anthropic', student_id: s.studentId, session_id: s.sessionId });
    expect(rows[0].error).toMatch(/credit/);
    expect(rows[1]).toMatchObject({ provider: 'openrouter', error: null, input_tokens: 120 });
    // OpenRouter: cùng model, không cho provider lưu dữ liệu.
    expect(o.calls[0]).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', provider: { data_collection: 'deny' } });
  });

  it('Claude API thành công: ghi tokens, cost theo bảng giá, prompt caching ở khối system ổn định', async () => {
    const s = await seedStudentEverywhere(appDb());
    const a = anthropicFetch([json(200, anthropicMessage('{"message":"ok"}'))]);
    setGatewayDependencies({ primary: a.provider, fallback: null });
    const result = await callLlm({
      purpose: 'tutor',
      studentId: s.studentId,
      promptVersion: 'tutor/v1',
      system: [{ text: 'quy tắc', cache: true }, { text: 'biến động' }],
      messages: [{ role: 'user', content: 'x' }],
      responseSchema: z.object({ message: z.string() }),
    });
    // Sonnet 5.5: 1000×2 + 50×10 + 2000×0,2 = 2900 / 1e6 USD.
    expect(result.costUsd).toBeCloseTo(0.0029, 6);
    const body = a.calls[0] as { system: { cache_control?: unknown }[]; output_config: { format?: unknown }; thinking?: unknown };
    expect(body.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[1]!.cache_control).toBeUndefined();
    expect(body.output_config.format).toBeDefined();
    expect(body.thinking).toEqual({ type: 'between_tools' });
    expect(body).not.toHaveProperty('temperature');
  });

  it('output sai schema → gọi lại đúng 1 lần', async () => {
    const s = await seedStudentEverywhere(appDb());
    const a = anthropicFetch([json(200, anthropicMessage('không phải JSON')), json(200, anthropicMessage('{"message":"ổn"}'))]);
    setGatewayDependencies({ primary: a.provider, fallback: null });
    const result = await callLlm({
      purpose: 'guard',
      studentId: s.studentId,
      promptVersion: 'guard/v1',
      system: [{ text: 's' }],
      messages: [{ role: 'user', content: 'x' }],
      responseSchema: z.object({ message: z.string() }),
    });
    expect(result.parsed).toEqual({ message: 'ổn' });
    expect(result.llmCallIds).toHaveLength(2);
  });

  it('cả hai provider lỗi → LlmUnavailableError, vẫn ghi đủ dòng llm_calls', async () => {
    const s = await seedStudentEverywhere(appDb());
    const a = anthropicFetch([creditError()]);
    const o = openRouterFetch([json(402, { error: { code: 402, message: 'Insufficient credits' } })]);
    setGatewayDependencies({ primary: a.provider, fallback: o.provider });
    const before = await appDb().query('SELECT count(*)::int AS n FROM llm_calls WHERE student_id = $1', [s.studentId]);
    await expect(
      callLlm({ purpose: 'hook', studentId: s.studentId, promptVersion: 'hook/v1', system: [{ text: 's' }], messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
    const after = await appDb().query('SELECT count(*)::int AS n FROM llm_calls WHERE student_id = $1', [s.studentId]);
    expect(after.rows[0].n - before.rows[0].n).toBe(2);
  });

  it('chế độ eval không bao giờ fallback OpenRouter và dừng khi vượt trần chi phí', async () => {
    const s = await seedStudentEverywhere(appDb());
    const o = openRouterFetch([]);
    const a = anthropicFetch([creditError()]);
    setGatewayDependencies({ evalPrimary: a.provider, fallback: o.provider });
    await expect(
      callLlm({ mode: 'eval', purpose: 'tutor', studentId: s.studentId, promptVersion: 'tutor/v1', system: [{ text: 's' }], messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(o.calls).toHaveLength(0);

    process.env.EVAL_COST_CAP_USD = '0.000001';
    const a2 = anthropicFetch([json(200, anthropicMessage('ok'))]);
    setGatewayDependencies({ evalPrimary: a2.provider });
    await callLlm({ mode: 'eval', purpose: 'tutor', studentId: s.studentId, promptVersion: 'tutor/v1', system: [{ text: 's' }], messages: [{ role: 'user', content: 'x' }] });
    await expect(
      callLlm({ mode: 'eval', purpose: 'tutor', studentId: s.studentId, promptVersion: 'tutor/v1', system: [{ text: 's' }], messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(EvalBudgetExceededError);
    delete process.env.EVAL_COST_CAP_USD;
  });

  it('purpose liên quan học sinh mà thiếu studentId → lỗi trước khi gọi model', async () => {
    await expect(
      callLlm({ purpose: 'tutor', promptVersion: 'tutor/v1', system: [{ text: 's' }], messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/studentId/);
  });

  it('JSON Schema strict: mọi object có additionalProperties false', () => {
    const schema = toStrictJsonSchema(z.object({ a: z.object({ b: z.string() }), c: z.array(z.object({ d: z.number() })) }));
    expect(JSON.stringify(schema).match(/"additionalProperties":false/g)).toHaveLength(3);
  });
});

describe('prompt loader', () => {
  it('ghi prompt_versions; sửa nội dung dưới id cũ → lỗi', async () => {
    const dir = 'prompts/zz_test_loader';
    mkdirSync(dir, { recursive: true });
    const id = `zz_test_loader/v${Date.now() % 100000}`;
    writeFileSync(`prompts/${id}.md`, 'Xin chào {name}');
    const p = await loadPrompt(id);
    expect(renderPrompt(p.content, { name: 'Việt' })).toBe('Xin chào Việt');
    expect(() => renderPrompt('Thiếu {x}', {})).toThrow(/x/);
    expect(renderPrompt('JSON {"message": "..."} giữ nguyên', {})).toBe('JSON {"message": "..."} giữ nguyên');
    const { rows } = await appDb().query('SELECT content_hash FROM prompt_versions WHERE id = $1', [id]);
    expect(rows[0].content_hash).toBe(p.contentHash);
    await appDb().query('UPDATE prompt_versions SET content_hash = $2 WHERE id = $1', [id, 'khac']);
    const { ensurePromptVersion } = await import('@/server/dal/prompt-versions-dal');
    await expect(ensurePromptVersion({ id, name: 'zz', content: p.content, contentHash: p.contentHash })).rejects.toThrow(/sửa tại chỗ/);
    const { rmSync } = await import('node:fs');
    rmSync(dir, { recursive: true, force: true });
  });
});
