'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FriendlyError, OfflineError, postJson, postSse } from '@/lib/sse-client';
import { linesFromTurn, type ChatLine, type ClientVoicePrefs, type ProblemResultDto, type StartDto, type TurnResultDto } from './chat-types';
import { Composer } from './composer';
import { MessageList } from './message-list';
import { OwlAvatar } from './owl-avatar';
import { OcrConfirmPanel, ProblemEntryPanel } from './problem-entry-panels';
import { BlockedScreen, EndOfProblem, IntroScreen, RestingScreen, SessionEndedScreen } from './simple-screens';
import { speakableTurnIds } from './tts-playback-logic';
import { useTtsPlayer } from './use-tts-player';
import type { SubmitMeta } from './voice-input-logic';

// Luồng chat của con (SPEC §15.12): mở phiên → nộp đề (gõ / chụp + khoanh vùng + xác nhận) → Cú mở bài →
// hỏi đáp (SSE) → chuyển giao → chấm vui/chán. Lỗi mạng → "Cú đang nghỉ"; không bao giờ hiện lỗi kỹ thuật.
// Trả lời bằng giọng là cách chính (micro trong Composer); Mít đọc to tin của mình (nút "nghe", tự đọc nếu bố mẹ bật).

type Phase = 'loading' | 'intro' | 'blocked' | 'offline' | 'problem' | 'confirm' | 'chat' | 'done' | 'ended';
const INTRO_KEY = 'cu_intro_seen_v1';

function readIntroSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

export function ChatApp({ studentName, voicePrefs }: { studentName: string; voicePrefs: ClientVoicePrefs }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState('');
  const [ocr, setOcr] = useState<{ problemId: string; text: string } | null>(null);
  const [rated, setRated] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Mốc lúc Cú vừa nói (đo thời gian con trả lời cho tín hiệu đoán bừa); 0 = chưa có.
  const lastCuAt = useRef(0);
  const tts = useTtsPlayer();

  const handleError = useCallback((err: unknown) => {
    if (err instanceof OfflineError) setPhase('offline');
    else if (err instanceof FriendlyError) setNotice(err.message);
    else setNotice('Mít đang mệt, bạn thử lại sau nhé.');
  }, []);

  const applyStart = useCallback((r: StartDto) => {
    if (!r.ok) {
      setBlocked(r.message);
      setPhase('blocked');
      return;
    }
    setSessionId(r.sessionId);
    setLines(r.lines);
    const finished = r.state === 'DONE' || r.state === 'PAUSE';
    setPhase(!readIntroSeen() ? 'intro' : r.hasProblem && !finished ? 'chat' : r.hasProblem ? 'done' : 'problem');
  }, []);

  // setState chỉ trong callback sau khi request xong (không render dây chuyền trong effect).
  const load = useCallback(() => postJson<StartDto>('/api/learn/start').then(applyStart, handleError), [applyStart, handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = () => {
    setPhase('loading');
    setNotice(null);
    void load();
  };

  const showTurn = (turn: TurnResultDto) => {
    const added = linesFromTurn(turn);
    setLines((prev) => [...prev, ...added]);
    if (voicePrefs.ttsAutoplay) tts.autoplay(speakableTurnIds(added));
    lastCuAt.current = Date.now();
    setPhase(turn.done || turn.paused ? 'done' : 'chat');
  };

  async function sendProblem(text: string, problemId?: string, meta?: SubmitMeta) {
    if (!sessionId) return;
    setNotice(null);
    setLines((prev) => [...prev, { turnId: `p-${Date.now()}`, from: 'student', text, kind: 'problem' }]);
    setPhase('chat');
    setBusy('Mít đang đọc kỹ đề bài');
    try {
      const voiceMeta = meta?.inputModality === 'voice' ? { inputModality: 'voice', ...(meta.sttPieces ? { sttPieces: meta.sttPieces } : {}) } : {};
      const r = await postSse<ProblemResultDto>('/api/learn/problem', { sessionId, text, problemId, ...voiceMeta }, setBusy);
      if (r.ok) showTurn(r.turn);
      else {
        setLines((prev) => [...prev, { turnId: `r-${Date.now()}`, from: 'cu', text: r.message, kind: 'notice' }]);
        setPhase('problem');
      }
    } catch (err) {
      handleError(err);
      setPhase((p) => (p === 'offline' ? p : 'problem'));
    } finally {
      setBusy(null);
    }
  }

  // "Mít ra đề cho bạn": đề tình huống hiện như một tin của Mít; không được thì quay lại màn nhập đề kèm lời nhắn.
  async function requestPractice() {
    if (!sessionId || busy) return;
    setNotice(null);
    setPhase('chat');
    setBusy('Mít đang nghĩ một đề hay cho bạn');
    try {
      const r = await postSse<ProblemResultDto>('/api/learn/practice', { sessionId }, setBusy);
      if (r.ok) showTurn(r.turn);
      else {
        setLines((prev) => [...prev, { turnId: `r-${Date.now()}`, from: 'cu', text: r.message, kind: 'notice' }]);
        setPhase('problem');
      }
    } catch (err) {
      handleError(err);
      setPhase((p) => (p === 'offline' ? p : 'problem'));
    } finally {
      setBusy(null);
    }
  }

  async function sendPhoto(file: File, crop: { x: number; y: number; width: number; height: number } | null) {
    if (!sessionId) return;
    setBusy('Mít đang đọc ảnh');
    setNotice(null);
    try {
      const form = new FormData();
      form.set('sessionId', sessionId);
      form.set('image', file);
      if (crop) form.set('crop', JSON.stringify(crop));
      const res = await fetch('/api/upload', { method: 'POST', body: form }).catch(() => {
        throw new OfflineError();
      });
      if (res.status >= 502) throw new OfflineError();
      const data = (await res.json()) as { ok?: boolean; problemId: string; extractedText: string; readable: boolean; message?: string };
      if (!res.ok || !data.ok) throw new FriendlyError('upload', data.message ?? 'Mít chưa đọc được ảnh này.');
      if (!data.readable || !data.extractedText.trim()) throw new FriendlyError('unreadable', 'Mít chưa đọc rõ ảnh. Bạn chụp lại hoặc gõ đề nhé.');
      setOcr({ problemId: data.problemId, text: data.extractedText });
      setPhase('confirm');
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  async function sendMessage(text: string, meta: SubmitMeta, hint = false) {
    if (!sessionId || busy) return;
    const key = crypto.randomUUID();
    const responseTimeMs = lastCuAt.current ? Date.now() - lastCuAt.current : 0;
    setNotice(null);
    setLines((prev) => [...prev, { turnId: `s-${key}`, from: 'student', text, kind: 'normal' }]);
    setBusy('Mít đang nghĩ');
    try {
      const body = { sessionId, text, idempotencyKey: key, hint, responseTimeMs, inputModality: meta.inputModality, ...(meta.sttPieces ? { sttPieces: meta.sttPieces } : {}) };
      const r = await postSse<TurnResultDto & { timeUp?: boolean }>('/api/chat', body);
      if (r.timeUp) {
        setBlocked(r.message);
        setPhase('blocked');
        return;
      }
      showTurn(r);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  async function rate(rating: 'fun' | 'ok' | 'boring') {
    if (!sessionId) return;
    setRated(true);
    await postJson('/api/learn/feedback', { sessionId, rating, end: false }).catch(() => undefined);
  }

  // "Xong hôm nay": đóng phiên (student_done) để báo cáo phiên tới bố mẹ ngay, không đợi 30 phút không hoạt động.
  async function finishToday() {
    if (!sessionId || finishing) return;
    setFinishing(true);
    setNotice(null);
    try {
      await postJson('/api/learn/feedback', { sessionId, rating: null, end: true });
      tts.stop();
      setSessionId(null);
      setLines([]);
      setRated(false);
      setPhase('ended');
    } catch (err) {
      handleError(err);
    } finally {
      setFinishing(false);
    }
  }

  if (phase === 'loading') return <RestingPlaceholder />;
  if (phase === 'offline') return <RestingScreen onRetry={retry} />;
  if (phase === 'blocked') return <BlockedScreen message={blocked} />;
  if (phase === 'ended') return <SessionEndedScreen onContinue={retry} />;
  if (phase === 'intro') {
    return (
      <IntroScreen
        name={studentName}
        onStart={() => {
          try {
            localStorage.setItem(INTRO_KEY, '1');
          } catch {
            /* trình duyệt chặn lưu: lần sau hiện lại giới thiệu, không sao */
          }
          setPhase(lines.length ? 'chat' : 'problem');
        }}
      />
    );
  }

  return (
    <div className="chat">
      <header className="chat-head">
        <OwlAvatar size={72} />
        <p className="chat-hello">Chào {studentName}!</p>
      </header>
      <MessageList lines={lines} busyText={busy} speech={tts} studentName={studentName} />
      {notice && (
        <p className="notice err" role="alert">
          {notice}
        </p>
      )}
      {phase === 'problem' && !busy && <ProblemEntryPanel
          voice={sessionId ? { sessionId, defaultLanguage: voicePrefs.sttLanguage, onRecordingStart: tts.stop } : undefined}
          onText={(t, meta) => void sendProblem(t, undefined, meta)}
          onPhoto={(f, c) => void sendPhoto(f, c)}
          onPractice={() => void requestPractice()}
        />}
      {phase === 'confirm' && ocr && (
        <OcrConfirmPanel
          text={ocr.text}
          onChange={(text) => setOcr({ ...ocr, text })}
          onRetake={() => {
            setOcr(null);
            setPhase('problem');
          }}
          onConfirm={(text) => void sendProblem(text, ocr.problemId)}
        />
      )}
      {phase === 'chat' && (
        <Composer
          disabled={!!busy}
          placeholder="Bạn trả lời Mít ở đây"
          submitLabel="Gửi"
          showHint
          voice={sessionId ? { sessionId, defaultLanguage: voicePrefs.sttLanguage, onRecordingStart: tts.stop } : undefined}
          onSubmit={(t, meta) => void sendMessage(t, meta)}
          onHint={() => void sendMessage('Mình cần gợi ý', { inputModality: 'text' }, true)}
        />
      )}
      {phase === 'done' && (
        <EndOfProblem
          rated={rated}
          finishing={finishing}
          onRate={(r) => void rate(r)}
          onFinish={() => void finishToday()}
          onNewProblem={() => {
            setRated(false);
            setPhase('problem');
          }}
        />
      )}
    </div>
  );
}

function RestingPlaceholder() {
  return <div className="center-screen" aria-busy="true" />;
}
