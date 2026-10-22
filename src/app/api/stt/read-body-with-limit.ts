// Đọc body request vào bộ nhớ nhưng có trần: đếm byte thật trong lúc đọc (không tin Content-Length),
// vượt trần thì huỷ stream ngay để client không đẩy tiếp hàng chục MB vào RAM của PC ở nhà.

export type LimitedBody = Uint8Array<ArrayBuffer> | 'too_large' | 'unreadable';

export async function readBodyWithLimit(request: Request, limitBytes: number): Promise<LimitedBody> {
  if (!request.body) return 'unreadable';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel().catch(() => undefined);
        return 'too_large';
      }
      chunks.push(value);
    }
  } catch {
    // Client ngắt giữa chừng hoặc stream lỗi: coi như body không hợp lệ.
    return 'unreadable';
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
