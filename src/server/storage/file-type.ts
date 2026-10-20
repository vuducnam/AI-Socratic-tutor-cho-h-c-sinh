import 'server-only';

// Nhận diện file theo magic bytes, không tin đuôi file hay Content-Type do client gửi.

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b);
}

export type ImageType = 'jpeg' | 'png' | 'webp';

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

export function detectConsentDocumentType(bytes: Uint8Array): 'pdf' | 'jpg' | 'png' | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  const image = detectImageType(bytes);
  if (image === 'jpeg') return 'jpg';
  if (image === 'png') return 'png';
  return null;
}
