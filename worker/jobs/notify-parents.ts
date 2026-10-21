import { getFlagNotificationTargets } from '@/server/dal/flags-dal';
import { buildFlagEmail, sendEmail } from '@/server/notify/email-sender';
import { systemActor } from '../actor';

// Gửi email cho mọi phụ huynh liên kết khi có cờ cần báo ngay (SPEC §13, khoá PIN SPEC §2.2).
// Email là kênh báo thêm: cờ và trạng thái khoá luôn hiện ở /parent. Chưa cấu hình SMTP_URL (chủ dự án chọn
// không gửi email) thì bỏ qua, không coi là lỗi để job không thử lại mãi.
export async function runNotifyParents(data: { flagId: string }): Promise<{ sent: number; skipped?: 'smtp_not_configured' }> {
  if (!process.env.SMTP_URL) {
    console.info(`[notify-parents] chưa cấu hình SMTP_URL, không gửi email cho cờ ${data.flagId} (cờ vẫn hiện ở /parent)`);
    return { sent: 0, skipped: 'smtp_not_configured' };
  }
  const actor = systemActor('gửi email báo phụ huynh');
  const { flag, recipients } = await getFlagNotificationTargets(actor, { flagId: data.flagId });
  for (const parent of recipients) {
    await sendEmail(buildFlagEmail({ to: parent.email, parentName: parent.name, flagType: flag.type }));
  }
  return { sent: recipients.length };
}
