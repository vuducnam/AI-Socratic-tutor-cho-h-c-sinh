import 'server-only';

// TransparencyRegistry (quy tắc cứng 2, SPEC §3.2): mọi bảng chứa dữ liệu học sinh phải có ở đây với
// parentView = true và export = true. Test registry.test.ts quét information_schema; thiếu bảng → CI fail.
// Khoá theo tên bảng thật trong DB (snake_case nhờ @@map).
//
// `scope` là điều kiện SQL trên bảng (tham số $1 = student_id). Registry không chạy SQL: export và
// parent view đọc qua DAL (quy tắc cứng 12).

export interface RegistryEntry {
  /** Điều kiện WHERE lọc dòng thuộc học sinh, tham số $1 là student_id. */
  scope: string;
  /** Có màn hình xem trong /parent. */
  parentView: boolean;
  /** Có trong file export zip. */
  export: boolean;
  /** Cột URI file (ảnh đề, ảnh nhiệm vụ, bản scan consent) để đóng gói vào thư mục files/ của zip. */
  fileColumns?: string[];
  /** Cột bí mật không đưa vào export (hash mật khẩu/PIN/token) — không phải dữ liệu về con. */
  omitColumns?: string[];
  /** Cột sắp xếp khi export và hiển thị. */
  orderBy: string;
  note?: string;
}

const SESSION_OF_STUDENT = 'session_id IN (SELECT id FROM sessions WHERE student_id = $1)';
const byStudent = (orderBy = 'created_at'): Pick<RegistryEntry, 'scope' | 'orderBy'> => ({
  scope: 'student_id = $1',
  orderBy,
});
const visible = { parentView: true, export: true } as const;

export const TransparencyRegistry = {
  students: { scope: 'id = $1', orderBy: 'created_at', omitColumns: ['pin_hash'], ...visible },
  consents: { ...byStudent('signed_at'), fileColumns: ['document_uri'], ...visible },
  parent_student: { ...byStudent(), ...visible },
  pin_lockouts: { ...byStudent('updated_at'), ...visible },
  trusted_devices: { ...byStudent(), omitColumns: ['token_hash'], ...visible },

  school_progress: { ...byStudent('set_at'), ...visible },
  school_progress_events: { ...byStudent(), ...visible },
  progress_suggestions: { ...byStudent(), ...visible },

  sessions: { ...byStudent('started_at'), ...visible },
  problems: { ...byStudent(), fileColumns: ['image_uri'], ...visible },
  solution_plans: {
    scope: 'problem_id IN (SELECT id FROM problems WHERE student_id = $1)',
    orderBy: 'created_at',
    ...visible,
  },
  turns: { scope: SESSION_OF_STUDENT, orderBy: 'session_id, seq', ...visible },
  llm_calls: {
    // Gồm cả lượt gọi ngoài phiên (báo cáo, OCR) nhờ student_id.
    scope: `(student_id = $1 OR ${SESSION_OF_STUDENT})`,
    orderBy: 'created_at',
    ...visible,
  },
  guard_verdicts: { scope: SESSION_OF_STUDENT, orderBy: 'created_at', ...visible },

  mastery: { ...byStudent('updated_at'), ...visible },
  mastery_events: { ...byStudent(), ...visible },
  learner_misconceptions: { ...byStudent('updated_at'), ...visible },
  review_schedule: { ...byStudent('due_at'), ...visible },
  flags: { ...byStudent(), ...visible },
  label_corrections: { ...byStudent(), ...visible },

  independent_results: { ...byStudent('taken_on'), ...visible },
  topic_arms: { ...byStudent('assigned_at'), ...visible },
  reports: { ...byStudent(), ...visible },
  decisions: { ...byStudent(), ...visible },

  missions: { ...byStudent('assigned_at'), ...visible },
  mission_artifacts: { ...byStudent(), fileColumns: ['image_uri'], ...visible },
  session_feedback: { ...byStudent(), ...visible },

  access_log: {
    ...byStudent(),
    ...visible,
    note: 'Gồm đăng nhập thất bại (IP, user agent). Lần thất bại với tên đăng nhập không tồn tại có student_id = null: chỉ admin xem.',
  },
  purge_requests: { ...byStudent(), ...visible },
} satisfies Record<string, RegistryEntry>;

export type TableName = keyof typeof TransparencyRegistry;

export const REGISTERED_TABLES = Object.keys(TransparencyRegistry) as TableName[];

export function registryEntry(table: TableName): RegistryEntry {
  return TransparencyRegistry[table];
}

/** Bảng không chứa dữ liệu học sinh, cố ý ngoài registry. */
export const NON_STUDENT_TABLES = [
  'users',
  'skills',
  'misconceptions',
  'allowed_sources',
  'curriculum_lessons',
  'beyond_scope_terms',
  'life_contexts',
  'system_alerts',
  'pending_file_deletions',
  'prompt_versions',
  '_prisma_migrations',
] as const;
