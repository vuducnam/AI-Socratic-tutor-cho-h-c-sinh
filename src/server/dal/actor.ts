import 'server-only';

// Hợp đồng Actor của DAL (SPEC §3.3, lệch có chủ đích: thêm `admin` và `reason`).
// Kiểu branded: chỉ tạo được qua mint-actor.ts, mà lint chỉ cho import ở src/server/auth/session.ts
// (từ phiên đã xác thực) và worker/actor.ts (system). Code khác không tự dựng được actor.
declare const actorBrand: unique symbol;

export type ActorType = 'admin' | 'parent' | 'student' | 'system';

export type Actor<T extends ActorType = ActorType> = {
  readonly type: T;
  readonly id: string;
  /** Bắt buộc khi admin đọc học sinh không liên kết với mình. */
  readonly reason?: string;
  readonly [actorBrand]: true;
};

export type SystemActor = Actor<'system'>;
export type StudentActor = Actor<'student'>;
export type ParentActor = Actor<'parent'>;
export type AdminActor = Actor<'admin'>;

/** id cố định của actor system trong access_log (worker, seed, script). */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
