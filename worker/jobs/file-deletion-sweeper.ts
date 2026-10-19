import {
  completePendingFileDeletion,
  listPendingFileDeletions,
  recordPendingFileDeletionFailure,
} from '@/server/dal/pending-file-deletions-dal';
import { deleteStorageFile } from '@/server/storage/local-file-storage';
import { systemActor } from '../actor';

// Xoá file ảnh/scan đã được purge_student() gom vào pending_file_deletions. Lỗi thì tăng attempts,
// lần chạy sau thử lại (job lặp định kỳ trong worker).
export const FILE_DELETION_SWEEPER_JOB = 'file-deletion-sweeper';

export async function runFileDeletionSweeper(): Promise<{ deleted: number; failed: number }> {
  const actor = systemActor('xoá file sau purge_student');
  let deleted = 0;
  let failed = 0;
  for (const row of await listPendingFileDeletions(actor)) {
    try {
      await deleteStorageFile(row.uri);
      await completePendingFileDeletion(actor, row.id);
      deleted += 1;
    } catch (err) {
      await recordPendingFileDeletionFailure(actor, row.id, err instanceof Error ? err.message : String(err));
      failed += 1;
    }
  }
  return { deleted, failed };
}
