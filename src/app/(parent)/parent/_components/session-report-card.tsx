// Báo cáo phiên (SPEC §11.2 › Phiên): số liệu do code tính, diễn giải của model chỉ hiện nhận định có
// bằng chứng; mỗi nhận định dẫn về lượt gốc trong transcript bên dưới.

interface Claim {
  text: string;
  evidence_turn_ids: string[];
  quote: string | null;
}

interface Narrative {
  summary?: Claim[];
  student_reasoning_quotes?: Claim[];
  concerns?: Claim[];
  dropped?: { reason: string }[];
  error?: string;
}

const METRIC_LABELS: Record<string, string> = {
  high_scaffold_rate: 'Tỉ lệ bài cần hỗ trợ bậc 3 trở lên',
  abandon_rate: 'Bỏ dở trước khi xong',
  guessing_rate: 'Lượt đoán bừa',
  scope_block_rate: 'Lượt Cú bị chặn vì vượt phạm vi',
  transfer_answer_rate: 'Có câu trả lời chuyển giao',
  fun_share: 'Con thấy vui',
  boring_share: 'Con thấy chán',
};

type Metric = { value: number | null; numerator?: number; denominator?: number; status?: string; reason?: string };

function ClaimList({ claims }: { claims: Claim[] }) {
  return (
    <ul>
      {claims.map((c, i) => (
        <li key={i}>
          {c.quote ? <q>{c.quote}</q> : c.text}{' '}
          {c.evidence_turn_ids.map((id) => (
            <a key={id} href={`#turn-${id}`} className="small">
              [lượt]
            </a>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function SessionReportCard({ report }: { report: { metrics: unknown; narrative: unknown; created_at: Date } | null }) {
  if (!report) {
    return (
      <section className="card">
        <h2>Báo cáo phiên</h2>
        <p className="muted">Chưa có báo cáo (báo cáo được tạo khi phiên kết thúc).</p>
      </section>
    );
  }
  const metrics = (report.metrics ?? {}) as Record<string, Metric>;
  const narrative = (report.narrative ?? {}) as Narrative;
  return (
    <section className="card">
      <h2>Báo cáo phiên</h2>
      <table>
        <tbody>
          {Object.entries(METRIC_LABELS).map(([key, label]) => {
            const m = metrics[key];
            if (!m) return null;
            return (
              <tr key={key}>
                <td>{label}</td>
                <td>{m.value === null ? `chưa đủ dữ liệu${m.reason ? ` (${m.reason})` : ''}` : `${m.numerator}/${m.denominator}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {narrative.error && <p className="notice err">{narrative.error}</p>}
      {!!narrative.summary?.length && (
        <>
          <h3>Tóm tắt</h3>
          <ClaimList claims={narrative.summary} />
        </>
      )}
      {!!narrative.student_reasoning_quotes?.length && (
        <>
          <h3>Lập luận của con (nguyên văn)</h3>
          <ClaimList claims={narrative.student_reasoning_quotes} />
        </>
      )}
      <h3>Điều cần chú ý</h3>
      {narrative.concerns?.length ? <ClaimList claims={narrative.concerns} /> : <p className="muted">Không có nhận định có bằng chứng.</p>}
      {!!narrative.dropped?.length && <p className="muted small">Đã loại {narrative.dropped.length} nhận định của model vì không có bằng chứng hợp lệ.</p>}
    </section>
  );
}
