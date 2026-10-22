// Client SSE cho /learn: POST JSON, đọc luồng `event: status|result|error`. Mất kết nối / server không
// phản hồi → ném OfflineError để giao diện hiện màn hình "Cú đang nghỉ" thay vì lỗi kỹ thuật.

export class OfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'OfflineError';
  }
}

export class FriendlyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'FriendlyError';
  }
}

export async function postSse<T>(url: string, body: unknown, onStatus?: (message: string) => void): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 401) {
    window.location.assign('/login');
    throw new FriendlyError('unauthenticated', 'Con đăng nhập lại nhé.');
  }
  if (res.status >= 502) throw new OfflineError();
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new FriendlyError(data.error ?? 'error', data.message ?? 'Mít chưa hiểu, bạn thử lại nhé.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw new OfflineError();
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event: (.+)$/m.exec(raw)?.[1];
      const data = /^data: (.+)$/m.exec(raw)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (event === 'status') onStatus?.(String(parsed.message ?? ''));
      if (event === 'error') throw new FriendlyError(String(parsed.code), String(parsed.message));
      if (event === 'result') return parsed as T;
    }
  }
  throw new OfflineError();
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new OfflineError();
  }
  if (res.status >= 502) throw new OfflineError();
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok && res.status !== 200) throw new FriendlyError(data.error ?? 'error', data.message ?? 'Mít chưa hiểu, bạn thử lại nhé.');
  return data;
}
