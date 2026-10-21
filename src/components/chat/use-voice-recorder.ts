'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { closeAudioContext, createAudioContext, startLevelMeter } from './audio-level-meter';
import { uploadForTranscript } from './stt-upload-client';
import {
  isVoiceCaptureSupported,
  MESSAGES,
  micErrorMessage,
  MIN_RECORDING_MS,
  pickRecorderFormat,
  RECORDING_LIMIT_MS,
  type RecorderStatus,
  type SttLanguage,
} from './voice-input-logic';

// Ghi âm bấm-để-nói: chạm để bắt đầu, chạm lần nữa để dừng (tự dừng sau 60 giây) → gửi /api/stt → trả chữ.
// Quy tắc cứng 10: tắt micro ngay khi dừng, không lưu audio ở client (mảng chunk và Blob bị bỏ ngay sau khi gửi).

export interface VoiceRecorderOptions {
  enabled: boolean;
  sessionId: string | null;
  language: SttLanguage;
  /** Phần tử nhận biến CSS `--level` (0..1) để vẽ mức âm lượng mà không render lại React mỗi khung hình. */
  levelTarget: RefObject<HTMLElement | null>;
  onStart: () => void;
  onTranscript: (text: string, receipt: string) => void;
}

export interface VoiceRecorder {
  supported: boolean;
  status: RecorderStatus;
  message: string | null;
  msLeft: number;
  toggle: () => void;
  /** Xoá lời nhắc cũ (vd. sau khi con đã gửi tin). Không ảnh hưởng lượt ghi đang chạy. */
  clearMessage: () => void;
}

interface Capture {
  stream: MediaStream;
  recorder: MediaRecorder;
  ctx: AudioContext | null;
  stopMeter: () => void;
  timer: ReturnType<typeof setInterval> | undefined;
  released: boolean;
  /** Bỏ bản ghi (rời trang giữa chừng): không gửi gì lên server. */
  discard: boolean;
}

const noopSubscribe = () => () => undefined;

function detectSupport(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return isVoiceCaptureSupported({
    isSecureContext: window.isSecureContext,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    isTypeSupported: typeof MediaRecorder === 'undefined' ? null : (t) => MediaRecorder.isTypeSupported(t),
  });
}

export function useVoiceRecorder(options: VoiceRecorderOptions): VoiceRecorder {
  const supported = useSyncExternalStore(noopSubscribe, detectSupport, () => false) && options.enabled;
  const router = useRouter();
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [msLeft, setMsLeft] = useState(RECORDING_LIMIT_MS);
  const latest = useRef(options);
  const capture = useRef<Capture | null>(null);
  const upload = useRef<AbortController | null>(null);
  // Mỗi lần bấm micro là một lượt; kết quả của lượt cũ (đã huỷ) bị bỏ qua.
  const runId = useRef(0);

  useEffect(() => {
    latest.current = options;
  });

  function release(c: Capture) {
    if (c.released) return;
    c.released = true;
    if (capture.current === c) capture.current = null;
    c.stopMeter();
    clearInterval(c.timer);
    c.stream.getTracks().forEach((t) => t.stop());
    closeAudioContext(c.ctx);
    latest.current.levelTarget.current?.style.setProperty('--level', '0');
  }

  function fail(text: string) {
    setStatus('error');
    setMessage(text);
  }

  async function transcribe(blob: Blob, extension: string, run: number) {
    const { sessionId, language } = latest.current;
    if (!sessionId) return fail(MESSAGES.unavailable);
    setStatus('transcribing');
    setMessage(null);
    const controller = new AbortController();
    upload.current = controller;
    const outcome = await uploadForTranscript({ audio: blob, extension, language, sessionId, signal: controller.signal });
    if (upload.current === controller) upload.current = null;
    if (!outcome || run !== runId.current) return;
    if (outcome.ok) {
      setStatus('idle');
      setMessage(MESSAGES.review);
      latest.current.onTranscript(outcome.text, outcome.receipt);
      return;
    }
    if (outcome.reason === 'unauthenticated') router.replace('/login');
    fail(outcome.message);
  }

  async function start() {
    const run = ++runId.current;
    latest.current.onStart();
    setStatus('requesting');
    setMessage(null);
    setMsLeft(RECORDING_LIMIT_MS);
    // Tạo AudioContext ngay trong thao tác chạm: Safari chỉ cho chạy AudioContext tạo trong cử chỉ người dùng.
    const ctx = createAudioContext();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (err) {
      closeAudioContext(ctx);
      if (run === runId.current) fail(micErrorMessage(err));
      return;
    }
    const format = pickRecorderFormat((t) => MediaRecorder.isTypeSupported(t));
    if (run !== runId.current || !format) {
      stream.getTracks().forEach((t) => t.stop());
      closeAudioContext(ctx);
      if (run === runId.current) fail(MESSAGES.micFailed);
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      closeAudioContext(ctx);
      return fail(MESSAGES.micFailed);
    }
    const c: Capture = { stream, recorder, ctx, stopMeter: () => undefined, timer: undefined, released: false, discard: false };
    capture.current = c;
    const chunks: Blob[] = [];
    const startedAt = Date.now();

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      c.discard = true; // sự kiện stop theo sau lỗi không được gửi bản ghi dở
      chunks.length = 0;
      release(c);
      if (run === runId.current) fail(MESSAGES.micFailed);
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAt;
      const blob = new Blob(chunks, { type: recorder.mimeType || format.mimeType });
      chunks.length = 0;
      release(c);
      if (c.discard || run !== runId.current) return;
      if (durationMs < MIN_RECORDING_MS || blob.size === 0) return fail(MESSAGES.empty);
      void transcribe(blob, format.extension, run);
    };

    try {
      recorder.start();
    } catch {
      release(c);
      return fail(MESSAGES.micFailed);
    }
    setStatus('recording');

    c.timer = setInterval(() => {
      const left = RECORDING_LIMIT_MS - (Date.now() - startedAt);
      // Làm tròn theo giây: React bỏ qua lần render khi giá trị không đổi.
      setMsLeft(Math.max(0, Math.ceil(left / 1000) * 1000));
      if (left <= 0 && recorder.state !== 'inactive') recorder.stop();
    }, 250);

    // Không có Web Audio thì không có thanh mức âm lượng, vẫn có đồng hồ đếm ngược.
    if (!c.released) c.stopMeter = startLevelMeter(ctx, stream, (level) => latest.current.levelTarget.current?.style.setProperty('--level', level.toFixed(2)));
  }

  function stop() {
    const c = capture.current;
    if (c && c.recorder.state !== 'inactive') {
      c.recorder.stop(); // onstop sẽ gửi bản ghi đi
      return;
    }
    if (status === 'requesting') {
      runId.current++; // con bấm lần nữa khi trình duyệt còn đang hỏi quyền: huỷ lượt này
      setStatus('idle');
    }
  }

  function toggle() {
    if (!supported) return;
    if (status === 'recording' || status === 'requesting') stop();
    else if (status === 'idle' || status === 'error') void start();
  }

  // Rời màn hình: tắt micro, huỷ upload đang chạy, bỏ bản ghi dở.
  useEffect(
    () => () => {
      runId.current++;
      upload.current?.abort();
      const c = capture.current;
      if (!c) return;
      c.discard = true;
      if (c.recorder.state !== 'inactive') c.recorder.stop();
      release(c);
    },
    // release chỉ dùng ref; chạy cleanup một lần khi unmount.
    [],
  );

  function clearMessage() {
    if (status === 'idle' || status === 'error') {
      setStatus('idle');
      setMessage(null);
    }
  }

  return { supported, status, message, msLeft, toggle, clearMessage };
}
