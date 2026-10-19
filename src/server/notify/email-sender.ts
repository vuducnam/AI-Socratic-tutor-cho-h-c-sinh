import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

// Email báo phụ huynh qua SMTP (cấu hình trong .env). Nội dung chỉ báo "có việc cần xem" + link /parent,
// không bao giờ chứa nội dung hội thoại của con (quy tắc cứng 10).

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  const url = process.env.SMTP_URL;
  if (!url) throw new Error('SMTP_URL chưa đặt');
  transporter ??= nodemailer.createTransport(url);
  return transporter;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? 'cu@localhost',
    to: email.to,
    subject: email.subject,
    text: email.text,
  });
}

const FLAG_SUBJECTS: Record<string, string> = {
  pin_soft_locked: 'Cú: tài khoản của con bị khoá tạm 15 phút',
  pin_hard_locked: 'Cú: tài khoản của con đang bị khoá, cần bố mẹ mở',
  safety_pause: 'Cú: có cuộc trò chuyện cần bố mẹ xem ngay',
};

export function buildFlagEmail(input: { to: string; parentName: string; flagType: string }): OutgoingEmail {
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
  return {
    to: input.to,
    subject: FLAG_SUBJECTS[input.flagType] ?? 'Cú: có việc cần bố mẹ xem',
    text: [
      `Chào ${input.parentName},`,
      '',
      'Cú vừa ghi nhận một việc bố mẹ cần xem. Vì lý do riêng tư, email không kèm nội dung.',
      `Mở trang phụ huynh để xem chi tiết: ${base}/parent`,
      '',
      'Cú',
    ].join('\n'),
  };
}
