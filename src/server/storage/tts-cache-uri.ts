import 'server-only';

// URI hàng chờ xoá (pending_file_deletions) cho toàn bộ cache TTS của một học sinh. Hợp đồng thuần, không
// đụng file: DAL ghi URI khi purge, worker đọc lại và gọi tầng voice xoá thư mục cache.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TTS_CACHE_URI_SCHEME = 'tts-cache:';

export function ttsCacheUriFor(studentId: string): string {
  if (!UUID_RE.test(studentId)) throw new Error('studentId không hợp lệ');
  return `${TTS_CACHE_URI_SCHEME}${studentId.toLowerCase()}`;
}

/** studentId (chữ thường) trong URI do ttsCacheUriFor tạo; URI khác → lỗi. */
export function studentIdFromTtsCacheUri(uri: string): string {
  const studentId = uri.startsWith(TTS_CACHE_URI_SCHEME) ? uri.slice(TTS_CACHE_URI_SCHEME.length) : '';
  if (!UUID_RE.test(studentId)) throw new Error(`URI cache TTS không hợp lệ: ${uri}`);
  return studentId.toLowerCase();
}
