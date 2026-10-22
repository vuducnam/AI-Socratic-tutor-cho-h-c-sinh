import { AnthropicProvider } from '@/server/llm/providers/anthropic-provider';

// Provider Claude "kịch bản": stub ở tầng HTTP (fetch), gateway và ghi llm_calls chạy thật.
// Mỗi phần tử là text model trả về (thường là JSON.stringify của output). Chỉ dùng hồ sơ giả.
export function scriptedAnthropic(outputs: (string | object)[]) {
  const requests: Record<string, unknown>[] = [];
  const queue = [...outputs];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const next = queue.shift();
    if (next === undefined) throw new Error('scriptedAnthropic: hết output kịch bản');
    const text = typeof next === 'string' ? next : JSON.stringify(next);
    return new Response(
      JSON.stringify({
        id: `msg_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: 'scripted',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_scripted' } },
    );
  }) as unknown as typeof fetch;
  return {
    provider: new AnthropicProvider({ apiKey: 'test', baseURL: 'http://scripted.test', fetch: fetchImpl }),
    requests,
    remaining: () => queue.length,
  };
}
