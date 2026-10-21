import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Metric audio_deleted (SPEC §12.2, quy tắc cứng 10): audio giọng con không còn trên đĩa sau STT.
// App không ghi audio ra đĩa (bytes chỉ nằm trong bộ nhớ request, src/server/voice/stt.ts); file tạm chỉ có ở
// stt-local. Hai lớp kiểm:
//  1. pytest của stt-local: mọi nhánh (thành công, lỗi giải mã, lỗi model, quá dung lượng) xoá file tạm.
//  2. Kiểm sống trên container đang chạy: gửi một bản ghi thử (âm tổng hợp, không phải giọng con) rồi xem /tmp
//     của container còn file `stt-*` không.
// Chạy được cả hai → 1 nếu cả hai đạt, 0 nếu một lớp hỏng. Không có stt-local đang chạy → null (eval:ci fail
// vì metric chặn thiếu số đo: muốn merge thì phải bật stt-local).

const STT_DIR = 'services/stt-local';

function sttPython(): string {
  const venv = process.platform === 'win32' ? join(STT_DIR, 'venv', 'Scripts', 'python.exe') : join(STT_DIR, 'venv', 'bin', 'python');
  return existsSync(venv) ? join(process.cwd(), venv) : 'python';
}

export function sttLocalTestsPassed(): boolean {
  try {
    execFileSync(sttPython(), ['-m', 'pytest', '-q'], { cwd: STT_DIR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** WAV PCM 16 kHz mono, 1 giây âm 220 Hz: đủ "có tiếng" để stt-local chạy tới bước giải mã + suy luận. */
function toneWav(): Uint8Array<ArrayBuffer> {
  const rate = 16_000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([header, data]));
}

/** null: không có stt-local đang chạy để kiểm. */
export async function liveSttLeavesNoAudio(): Promise<boolean | null> {
  const baseUrl = process.env.STT_LOCAL_URL?.replace(/\/$/, '');
  if (!baseUrl) return null;
  const form = new FormData();
  form.append('audio', new Blob([toneWav()], { type: 'audio/wav' }), 'audio.wav');
  form.append('language', 'vi');
  try {
    const res = await fetch(`${baseUrl}/transcribe`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) return false;
  } catch {
    return null;
  }
  try {
    const leftovers = execFileSync('docker', ['compose', 'exec', '-T', 'stt-local', 'find', '/tmp', '-maxdepth', '1', '-name', 'stt-*'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return leftovers.toString().trim() === '';
  } catch {
    return null;
  }
}

export async function audioDeletedPassed(): Promise<boolean | null> {
  const live = await liveSttLeavesNoAudio();
  if (live === null) return null;
  return live && sttLocalTestsPassed();
}
