import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MATH_VERIFIER_URL, verifyAnswer } from './math-verifier-client';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyAnswer', () => {
  it('gửi đúng JSON tới /verify và trả kết quả đã validate', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ ok: true, computed: '0.95', detail: 'match' }));
    const result = await verifyAnswer(
      { kind: 'number', expression: '0.45+0.5', expected: '0.95' },
      { baseUrl: 'http://verifier.test/', fetchImpl },
    );
    expect(result).toEqual({ ok: true, computed: '0.95', detail: 'match' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://verifier.test/verify');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ kind: 'number', expression: '0.45+0.5', expected: '0.95' });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('nhận computed dạng danh sách và null', async () => {
    const list = fakeFetch(() => json({ ok: true, computed: ['0.3', '0.4'], detail: 'match' }));
    expect(
      await verifyAnswer({ kind: 'number_list', expression: '[0.3, 0.4]', expected: ['0.3', '0.4'] }, { fetchImpl: list.fetchImpl }),
    ).toEqual({ ok: true, computed: ['0.3', '0.4'], detail: 'match' });

    const rejected = fakeFetch(() => json({ ok: false, computed: null, detail: 'unsafe_syntax: Attribute' }));
    expect(
      await verifyAnswer({ kind: 'number', expression: '().__class__', expected: '1' }, { fetchImpl: rejected.fetchImpl }),
    ).toEqual({ ok: false, computed: null, detail: 'unsafe_syntax: Attribute' });
  });

  it('dùng MATH_VERIFIER_URL, mặc định localhost:8001', async () => {
    const first = fakeFetch(() => json({ ok: true, computed: '<', detail: 'match' }));
    await verifyAnswer({ kind: 'relation', expression: '0.45 < 0.5', expected: '<' }, { fetchImpl: first.fetchImpl });
    expect(first.calls[0]!.url).toBe(`${DEFAULT_MATH_VERIFIER_URL}/verify`);

    vi.stubEnv('MATH_VERIFIER_URL', 'http://math-verifier:8001');
    const second = fakeFetch(() => json({ ok: true, computed: '1', detail: 'match' }));
    await verifyAnswer({ kind: 'choice', expression: 'argmax(2.85, 2.9)', expected: '1' }, { fetchImpl: second.fetchImpl });
    expect(second.calls[0]!.url).toBe('http://math-verifier:8001/verify');
  });

  it('lỗi mạng → verifier_unavailable, không ném', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(verifyAnswer({ kind: 'number', expression: '1', expected: '1' }, { fetchImpl })).resolves.toEqual({
      ok: false,
      computed: null,
      detail: 'verifier_unavailable',
    });
  });

  it('quá giờ → verifier_unavailable', async () => {
    const { fetchImpl } = fakeFetch(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const result = await verifyAnswer({ kind: 'number', expression: '1', expected: '1' }, { fetchImpl, timeoutMs: 20 });
    expect(result).toEqual({ ok: false, computed: null, detail: 'verifier_unavailable' });
  });

  it('5xx → verifier_unavailable; 4xx → verifier_bad_request', async () => {
    const down = fakeFetch(() => new Response('bad gateway', { status: 502 }));
    expect((await verifyAnswer({ kind: 'number', expression: '1', expected: '1' }, { fetchImpl: down.fetchImpl })).detail).toBe(
      'verifier_unavailable',
    );
    const invalid = fakeFetch(() => json({ detail: [] }, 422));
    expect((await verifyAnswer({ kind: 'number', expression: '1', expected: '1' }, { fetchImpl: invalid.fetchImpl })).detail).toBe(
      'verifier_bad_request',
    );
  });

  it('phản hồi sai hình dạng hoặc không phải JSON → verifier_bad_response', async () => {
    const wrongShape = fakeFetch(() => json({ ok: 'yes', computed: 1, detail: 'match' }));
    expect(
      (await verifyAnswer({ kind: 'number', expression: '1', expected: '1' }, { fetchImpl: wrongShape.fetchImpl })).detail,
    ).toBe('verifier_bad_response');
    const notJson = fakeFetch(() => new Response('<html>', { status: 200 }));
    expect((await verifyAnswer({ kind: 'number', expression: '1', expected: '1' }, { fetchImpl: notJson.fetchImpl })).detail).toBe(
      'verifier_bad_response',
    );
  });

  it('request sai hình dạng → invalid_request, không gọi mạng', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ ok: true, computed: '1', detail: 'match' }));
    const bad = [
      { kind: 'eval', expression: '1', expected: '1' },
      { kind: 'number', expression: '', expected: '1' },
      { kind: 'number', expression: '1'.repeat(501), expected: '1' },
      { kind: 'number_list', expression: '[1]', expected: [] },
    ];
    for (const request of bad) {
      // Ép kiểu có chủ đích: mô phỏng dữ liệu LLM sinh sai hợp đồng đi qua biên.
      const result = await verifyAnswer(request as Parameters<typeof verifyAnswer>[0], { fetchImpl });
      expect(result).toEqual({ ok: false, computed: null, detail: 'invalid_request' });
    }
    expect(calls).toHaveLength(0);
  });
});
