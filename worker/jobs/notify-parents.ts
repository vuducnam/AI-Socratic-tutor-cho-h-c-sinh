import { getFlagNotificationTargets } from '@/server/dal/flags-dal';
import { buildFlagEmail, sendEmail } from '@/server/notify/email-sender';
import { systemActor } from '../actor';

// Gửi email cho mọi phụ huynh liên kết khi có cờ cần báo ngay (SPEC §13, khoá PIN SPEC §2.2).
export async function runNotifyParents(data: { flagId: string }): Promise<{ sent: number }> {
  const actor = systemActor('gửi email báo phụ huynh');
  const { flag, recipients } = await getFlagNotificationTargets(actor, { flagId: data.flagId });
  for (const parent of recipients) {
    await sendEmail(buildFlagEmail({ to: parent.email, parentName: parent.name, flagType: flag.type }));
  }
  return { sent: recipients.length };
}
