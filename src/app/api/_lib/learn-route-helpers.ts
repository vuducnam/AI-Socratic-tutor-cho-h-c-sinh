import { requireStudentActor, UnauthenticatedError } from '@/server/auth/session';
import type { StudentActor } from '@/server/dal/actor';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { NoActiveProblemError, ProblemFinishedError } from '@/server/domain/dialogue/run-turn';
import { TurnBusyError } from '@/server/domain/dialogue/turn-lock';
import { ProblemImageError } from '@/server/domain/input/sanitize-problem-image';
import { LlmUnavailableError } from '@/server/llm/llm-gateway';

// Dùng chung cho route của /learn: xác thực học sinh, đổi lỗi nghiệp vụ thành câu thân thiện cho con
// (không lộ lỗi kỹ thuật), và stream SSE bằng ReadableStream (route chỉ xác thực → zod → domain).

export type SseSend = (event: 'status' | 'result' | 'error', data: unknown) => void;

export function friendlyError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof UnauthenticatedError) return { status: 401, code: 'unauthenticated', message: 'Bạn đăng nhập lại nhé.' };
  if (err instanceof AuthorizationError) return { status: 403, code: 'forbidden', message: 'Bạn không mở được phần này.' };
  if (err instanceof TurnBusyError) return { status: 409, code: 'busy', message: 'Mít đang nghĩ câu trước, bạn chờ một chút nhé.' };
  if (err instanceof NoActiveProblemError) return { status: 409, code: 'no_problem', message: 'Bạn gửi đề bài cho Mít trước nhé.' };
  if (err instanceof ProblemFinishedError) return { status: 409, code: 'problem_finished', message: 'Bài này xong rồi, bạn gửi bài mới nhé.' };
  if (err instanceof ProblemImageError) return { status: 400, code: 'bad_image', message: err.message };
  if (err instanceof LlmUnavailableError) return { status: 503, code: 'llm_unavailable', message: err.friendlyMessage };
  // Lỗi chưa lường trước: con chỉ thấy câu thân thiện, nên phải ghi lỗi gốc ra log server để còn sửa được.
  console.error('[learn] lỗi không lường trước:', err);
  return { status: 500, code: 'error', message: 'Mít đang mệt, bạn thử lại sau nhé.' };
}

export async function studentOr401(): Promise<StudentActor | Response> {
  try {
    return await requireStudentActor();
  } catch (err) {
    const e = friendlyError(err);
    return Response.json({ error: e.code, message: e.message }, { status: e.status });
  }
}

export function sseResponse(work: (send: SseSend) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: SseSend = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      // Giữ kết nối sống trong lúc Pre-solver/Tutor nghĩ (proxy có thể cắt kết nối im lặng).
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 10_000);
      try {
        await work(send);
      } catch (err) {
        const e = friendlyError(err);
        if (e.code === 'error') console.error('[learn] lỗi', err);
        send('error', { code: e.code, message: e.message });
      } finally {
        clearInterval(keepAlive);
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
