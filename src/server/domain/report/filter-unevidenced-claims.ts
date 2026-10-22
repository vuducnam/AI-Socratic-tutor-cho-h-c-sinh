import 'server-only';
import { z } from 'zod';

// Lọc nhận định của LLM (quy tắc cứng 4): mỗi nhận định phải có evidence_turn_ids / evidence_session_ids
// tồn tại và thuộc đúng học sinh; câu trích nguyên văn phải có thật trong lượt được dẫn. Không có bằng
// chứng hợp lệ → bị loại TRƯỚC khi lưu/hiển thị.

export const claimSchema = z.object({
  text: z.string().min(1).max(500),
  evidence_session_ids: z.array(z.string()).max(20),
  evidence_turn_ids: z.array(z.string()).max(20),
  /** Câu nguyên văn của con được trích (nếu có). */
  quote: z.string().max(300).nullable(),
});
export type Claim = z.infer<typeof claimSchema>;

export const narrativeSchema = z.object({
  summary: z.array(claimSchema).max(8),
  student_reasoning_quotes: z.array(claimSchema).max(2),
  concerns: z.array(claimSchema).max(8),
});
export type Narrative = z.infer<typeof narrativeSchema>;

export interface EvidenceIndex {
  turnIds: Set<string>;
  sessionIds: Set<string>;
  /** Nội dung lượt (để kiểm câu trích). */
  turnText: Map<string, string>;
}

export interface FilterResult {
  narrative: Narrative;
  dropped: { section: string; claim: Claim; reason: string }[];
}

function check(claim: Claim, idx: EvidenceIndex): string | null {
  if (!claim.evidence_turn_ids.length && !claim.evidence_session_ids.length) return 'không có bằng chứng';
  const badTurn = claim.evidence_turn_ids.find((id) => !idx.turnIds.has(id));
  if (badTurn) return `turn ${badTurn} không thuộc học sinh`;
  const badSession = claim.evidence_session_ids.find((id) => !idx.sessionIds.has(id));
  if (badSession) return `session ${badSession} không thuộc học sinh`;
  if (claim.quote) {
    const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    const found = claim.evidence_turn_ids.some((id) => norm(idx.turnText.get(id) ?? '').includes(norm(claim.quote!)));
    if (!found) return 'câu trích không có nguyên văn trong lượt được dẫn';
  }
  return null;
}

export function filterUnevidencedClaims(narrative: Narrative, idx: EvidenceIndex): FilterResult {
  const dropped: FilterResult['dropped'] = [];
  const keep = (section: keyof Narrative) =>
    narrative[section].filter((claim) => {
      const reason = check(claim, idx);
      if (reason) dropped.push({ section, claim, reason });
      return !reason;
    });
  return { narrative: { summary: keep('summary'), student_reasoning_quotes: keep('student_reasoning_quotes'), concerns: keep('concerns') }, dropped };
}
