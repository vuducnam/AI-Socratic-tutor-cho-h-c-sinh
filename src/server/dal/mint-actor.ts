import 'server-only';
import type { Actor, ActorType } from './actor';

// Chỉ src/server/auth/session.ts và worker/actor.ts được import file này (ESLint chặn chỗ khác).
export function mintActor<T extends ActorType>(type: T, id: string, reason?: string): Actor<T> {
  return Object.freeze({ type, id, ...(reason ? { reason } : {}) }) as Actor<T>;
}
