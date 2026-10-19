import 'server-only';
import { z } from 'zod';
import { callLlm } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';

// Đọc ảnh đề (SPEC §6 bước 1): Claude vision chép nguyên văn, không giải; chỗ không rõ ghi [?].
// Ảnh vào đây đã được bỏ EXIF/GPS và cắt vùng đề (phase 15) nên không chứa tên con, tên trường.
// Kết quả hiển thị lại cho con xác nhận → confirmed_text.

export const OCR_PROMPT = 'ocr/v1';

export const ocrOutputSchema = z.object({
  problem_text: z.string().max(4000),
  readable: z.boolean(),
  unclear_count: z.number().int().min(0).max(100),
});

export type OcrOutput = z.infer<typeof ocrOutputSchema>;

export async function extractProblemFromImage(input: {
  studentId: string;
  sessionId: string;
  grade: number;
  image: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string; storageUri: string };
  mode?: 'live' | 'eval';
}): Promise<OcrOutput & { llmCallId: string }> {
  const prompt = await loadPrompt(OCR_PROMPT);
  const result = await callLlm({
    purpose: 'ocr',
    studentId: input.studentId,
    sessionId: input.sessionId,
    promptVersion: OCR_PROMPT,
    system: [{ text: renderPrompt(prompt.content, { grade: input.grade }) }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', mediaType: input.image.mediaType, base64: input.image.base64, sourceUri: input.image.storageUri },
          { type: 'text', text: 'Chép lại đề bài trong ảnh.' },
        ],
      },
    ],
    responseSchema: ocrOutputSchema,
    mode: input.mode,
  });
  return { ...result.parsed!, llmCallId: result.llmCallId };
}
