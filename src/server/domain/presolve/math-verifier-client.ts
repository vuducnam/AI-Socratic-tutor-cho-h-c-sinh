import 'server-only';

import { z } from 'zod';

// Client cho sidecar math-verifier (SPEC §15.7): POST /verify {kind, expression, expected} → {ok, computed, detail}.
// Hợp đồng theo kind và cú pháp biểu thức nằm ở services/math-verifier/app/verify.py và safe_parse.py
// (số dùng dấu CHẤM thập phân; relation: "0.45 < 0.5" + "<"; choice: "argmax(...)" + chỉ số 0-based).
// Không bao giờ ném lỗi: verifier không gọi được / quá giờ → ok=false, detail='verifier_unavailable', nên
// Pre-solver coi như CHƯA verify (không dạy dựa trên plan chưa verify, SPEC §8.2).

export const DEFAULT_MATH_VERIFIER_URL = 'http://localhost:8001';
// Sandbox phía server giết phép tính sau 5 giây; chừa thêm cho mạng và khởi động tiến trình con.
export const DEFAULT_MATH_VERIFIER_TIMEOUT_MS = 8_000;

export const verifyKindSchema = z.enum(['number', 'number_list', 'relation', 'choice']);
export type VerifyKind = z.infer<typeof verifyKindSchema>;

export const verifyRequestSchema = z.strictObject({
  kind: verifyKindSchema,
  expression: z.string().min(1).max(500),
  expected: z.union([z.string().min(1).max(64), z.array(z.string().min(1).max(64)).min(1).max(50)]),
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

const verifyResponseSchema = z.object({
  ok: z.boolean(),
  computed: z.union([z.string(), z.array(z.string()), z.null()]),
  detail: z.string(),
});
export type VerifyResult = z.infer<typeof verifyResponseSchema>;

/** Mã detail do client sinh (verifier không trả các mã này). */
export type VerifierClientFailure =
  | 'invalid_request'
  | 'verifier_unavailable'
  | 'verifier_bad_request'
  | 'verifier_bad_response';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type VerifyOptions = {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

function failure(detail: VerifierClientFailure): VerifyResult {
  return { ok: false, computed: null, detail };
}

export async function verifyAnswer(request: VerifyRequest, options: VerifyOptions = {}): Promise<VerifyResult> {
  // Biểu thức do LLM sinh: kiểm hình dạng tại biên trước khi gửi đi.
  const parsedRequest = verifyRequestSchema.safeParse(request);
  if (!parsedRequest.success) return failure('invalid_request');

  const baseUrl = (options.baseUrl ?? process.env.MATH_VERIFIER_URL ?? DEFAULT_MATH_VERIFIER_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsedRequest.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_MATH_VERIFIER_TIMEOUT_MS),
    });
  } catch {
    return failure('verifier_unavailable');
  }

  // 4xx là lỗi hợp đồng phía gọi (422 sai cấu trúc, 413 quá lớn); 5xx là verifier đang hỏng.
  if (response.status >= 500) return failure('verifier_unavailable');
  if (!response.ok) return failure('verifier_bad_request');

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure('verifier_bad_response');
  }
  const parsedBody = verifyResponseSchema.safeParse(body);
  return parsedBody.success ? parsedBody.data : failure('verifier_bad_response');
}
