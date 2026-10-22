import 'server-only';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// prompt_versions: không sửa, chỉ thêm version mới (SPEC §8). Cùng id mà hash khác → lỗi.

export class PromptVersionChangedError extends Error {
  constructor(id: string) {
    super(`Prompt ${id} đã bị sửa tại chỗ (hash khác bản đã ghi). Tạo version mới thay vì sửa file cũ.`);
    this.name = 'PromptVersionChangedError';
  }
}

export async function ensurePromptVersion(input: { id: string; name: string; content: string; contentHash: string }): Promise<void> {
  const existing = await prisma.promptVersion.findUnique({ where: { id: input.id }, select: { content_hash: true } });
  if (existing) {
    if (existing.content_hash !== input.contentHash) throw new PromptVersionChangedError(input.id);
    return;
  }
  await prisma.promptVersion
    .create({ data: { id: input.id, name: input.name, content: input.content, content_hash: input.contentHash } })
    .catch(async (err: unknown) => {
      // Hai process cùng ghi lần đầu: chấp nhận nếu bản kia trùng hash.
      const again = await prisma.promptVersion.findUnique({ where: { id: input.id }, select: { content_hash: true } });
      if (again?.content_hash !== input.contentHash) throw err;
    });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  ensurePromptVersion: { kind: 'no-actor', reason: 'ghi nội dung prompt (không có dữ liệu học sinh)' },
};
