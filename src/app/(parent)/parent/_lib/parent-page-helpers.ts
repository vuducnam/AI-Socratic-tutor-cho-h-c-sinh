import 'server-only';
import { ZodError } from 'zod';
import type { ParentActor } from '@/server/dal/actor';
import { listLinkedStudents } from '@/server/dal/students-dal';

// Tiện ích chung cho các trang /parent: chọn con đang xem, định dạng thời gian theo giờ Việt Nam,
// dựng URL kèm thông báo sau Server Action.

export type LinkedChild = Awaited<ReturnType<typeof listLinkedStudents>>[number];

/** Con đang xem: theo ?studentId nếu thuộc danh sách liên kết, không thì con đầu tiên. */
export async function loadSelectedChild(actor: ParentActor, studentId: string | undefined) {
  const children = await listLinkedStudents(actor);
  const selected = children.find((c) => c.id === studentId) ?? children[0] ?? null;
  return { children, selected };
}

const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Saigon', dateStyle: 'short', timeStyle: 'medium' });

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? String(value) : dateTimeFormat.format(d);
}

/** Số thập phân hiển thị kiểu Việt (dấu phẩy). */
export function formatDecimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replace('.', ',');
}

/** URL quay lại trang kèm ?studentId và thông báo ok/err (đọc ở trang đích). */
export function noticeUrl(path: string, notice: { ok?: string; err?: string }, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  if (notice.ok) query.set('ok', notice.ok);
  if (notice.err) query.set('err', notice.err);
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Thông báo lỗi an toàn cho phụ huynh (không lộ chi tiết kỹ thuật). */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ZodError) return err.issues[0]?.message ?? fallback;
  if (!(err instanceof Error)) return fallback;
  if (err.name === 'AuthorizationError') return 'Không có quyền với hồ sơ này';
  // Chỉ lỗi nghiệp vụ do code mình ném (message tiếng Việt); lỗi DB/thư viện → thông báo chung.
  if (err.name === 'Error' || err.name === 'PurgeConfirmationError') return err.message || fallback;
  console.error('[parent]', err);
  return fallback;
}

export const SEVERITY_LABELS: Record<string, string> = { info: 'Thông tin', warning: 'Cần chú ý', high: 'Nghiêm trọng' };
export const RATING_LABELS: Record<string, string> = { fun: 'Vui', ok: 'Bình thường', boring: 'Chán' };
