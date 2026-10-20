import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

// Ảnh đề, ảnh nhiệm vụ, bản scan consent lưu trên SSD ngoài web root. URI dạng `storage:<đường dẫn tương đối>`.
const SCHEME = 'storage:';

function storageRoot(): string {
  // turbopackIgnore: thư mục storage nằm ngoài bundle, không để Next trace cả project.
  return resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? './storage');
}

export function resolveStorageUri(uri: string): string {
  if (!uri.startsWith(SCHEME)) throw new Error(`URI không thuộc storage: ${uri}`);
  const root = storageRoot();
  const full = resolve(/*turbopackIgnore: true*/ root, uri.slice(SCHEME.length));
  // Chặn path traversal ra ngoài thư mục storage.
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`URI ra ngoài storage: ${uri}`);
  return full;
}

export function toStorageUri(relativePath: string): string {
  return `${SCHEME}${relativePath.replaceAll('\\', '/')}`;
}

export async function writeStorageFile(relativePath: string, data: Uint8Array): Promise<string> {
  const uri = toStorageUri(relativePath);
  const full = resolveStorageUri(uri);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data, { flag: 'wx' });
  return uri;
}

export async function readStorageFile(uri: string): Promise<Buffer> {
  return readFile(resolveStorageUri(uri));
}

/** Xoá file; file đã không còn thì coi như xoá xong (idempotent). */
export async function deleteStorageFile(uri: string): Promise<void> {
  await rm(resolveStorageUri(uri), { force: true });
}
