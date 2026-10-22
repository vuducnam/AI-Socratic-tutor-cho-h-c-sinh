'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireParentActor } from '@/server/auth/session';
import {
  createIndependentResult,
  independentResultInputSchema,
  setTopicArm,
  TOPIC_ARMS,
} from '@/server/dal/independent-results-dal';
import { errorMessage, noticeUrl } from '../_lib/parent-page-helpers';

// Server Action trang Dữ liệu độc lập. Validate form bằng schema của DAL; DAL kiểm liên kết và validate lại.

const PATH = '/parent/independent';

function back(notice: { ok?: string; err?: string }, studentId?: string): never {
  redirect(noticeUrl(PATH, notice, studentId ? { studentId } : {}));
}

const optionalText = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : undefined);

export async function createIndependentResultAction(form: FormData) {
  const actor = await requireParentActor();
  const studentId = z.uuid().safeParse(form.get('studentId'));
  if (!studentId.success) back({ err: 'Yêu cầu không hợp lệ' });
  const parsed = independentResultInputSchema.safeParse({
    type: form.get('type'),
    skillIds: form.getAll('skillIds').filter((v): v is string => typeof v === 'string' && v !== ''),
    score: optionalText(form.get('score')),
    maxScore: optionalText(form.get('maxScore')),
    note: optionalText(form.get('note')),
    takenOn: optionalText(form.get('takenOn')) ?? '',
  });
  if (!parsed.success) back({ err: parsed.error.issues[0]?.message ?? 'Thông tin chưa hợp lệ' }, studentId.data);
  let error: string | null = null;
  try {
    await createIndependentResult(actor, { studentId: studentId.data, result: parsed.data });
  } catch (err) {
    error = errorMessage(err, 'Không lưu được');
  }
  back(error ? { err: error } : { ok: 'Đã lưu kết quả' }, studentId.data);
}

const armForm = z.object({ studentId: z.uuid(), skillId: z.string().trim().min(1).max(100), arm: z.enum(TOPIC_ARMS) });

export async function setTopicArmAction(form: FormData) {
  const actor = await requireParentActor();
  const parsed = armForm.safeParse({ studentId: form.get('studentId'), skillId: form.get('skillId'), arm: form.get('arm') });
  if (!parsed.success) back({ err: 'Chọn nhóm cho kỹ năng' }, optionalText(form.get('studentId')));
  let error: string | null = null;
  try {
    await setTopicArm(actor, parsed.data);
  } catch (err) {
    error = errorMessage(err, 'Không lưu được');
  }
  back(error ? { err: error } : { ok: 'Đã gán nhóm' }, parsed.data.studentId);
}
