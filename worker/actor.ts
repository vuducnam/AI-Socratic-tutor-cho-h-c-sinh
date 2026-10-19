import { SYSTEM_ACTOR_ID, type SystemActor } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';

// Actor `system` cho worker, seed và scripts. Đọc dữ liệu học sinh bằng actor này vẫn ghi access_log.
export function systemActor(reason: string): SystemActor {
  return mintActor('system', SYSTEM_ACTOR_ID, reason);
}
