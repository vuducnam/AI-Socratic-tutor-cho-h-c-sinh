'use client';

import { rmsLevel } from './voice-input-logic';

// Đo mức âm lượng micro mỗi khung hình (AnalyserNode) để con thấy máy đang nghe. Chỉ đọc mức to/nhỏ,
// không lưu hay gửi mẫu âm thanh đi đâu. Trả về hàm dừng đo; lỗi Web Audio thì không đo, ghi âm vẫn chạy.

export function createAudioContext(): AudioContext | null {
  try {
    return typeof AudioContext === 'undefined' ? null : new AudioContext();
  } catch {
    return null;
  }
}

export function closeAudioContext(ctx: AudioContext | null) {
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
}

export function startLevelMeter(ctx: AudioContext | null, stream: MediaStream, onLevel: (level: number) => void): () => void {
  if (!ctx) return () => undefined;
  let raf = 0;
  let stopped = false;
  try {
    void ctx.resume().catch(() => undefined);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (stopped) return;
      analyser.getByteTimeDomainData(samples);
      onLevel(rmsLevel(samples));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch {
    return () => undefined;
  }
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
