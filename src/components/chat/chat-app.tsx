'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FriendlyError, OfflineError, postJson, postSse } from '@/lib/sse-client';
import { linesFromTurn, type ChatLine, type ProblemResultDto, type StartDto, type TurnResultDto } from './chat-types';
import { Composer } from './composer';
import { MessageList } from './message-list';
import { PhotoProblem } from './photo-problem';
import { BlockedScreen, EndOfProblem, IntroScreen, RestingScreen } from './simple-screens';

// Luồng chat của con (SPEC §15.12): mở phiên → nộp đề (gõ / chụp + khoanh vùng + xác nhận) → Cú mở bài →
// hỏi đáp (SSE) → chuyển giao → chấm vui/chán. Lỗi mạng → "Cú đang nghỉ"; không bao giờ hiện lỗi kỹ thuật.

type Phase = 'loading' | 'intro' | 'blocked' | 'offline' | 'problem' | 'confirm' | 'chat' | 'done';
const INTRO_KEY = 'cu_intro_seen_v1';

function readIntroSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

export function ChatApp({ studentName }: { studentName: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState('');
  const [ocr, setOcr] = useState<{ problemId: string; text: string } | null>(null);
  const [rated, setRated] = useState(false);
  // Mốc lúc Cú vừa nói (đo thời gian con trả lời cho tín hiệu đoán bừa); 0 = chưa có.
  const lastCuAt = useRef(0);

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
    setLines((prev) => [...prev, ...linesFromTurn(turn)]);
    lastCuAt.current = Date.now();
    setPhase(turn.done || turn.paused ? 'done' : 'chat');
  };

  async function sendProblem(text: string, problemId?: string) {
    if (!sessionId) return;
    setNotice(null);
    setLines((prev) => [...prev, { turnId: `p-${Date.now()}`, from: 'student', text, kind: 'problem' }]);
    setPhase('chat');
    setBusy('Mít đang đọc kỹ đề bài');
    try {
      const r = await postSse<ProblemResultDto>('/api/learn/problem', { sessionId, text, problemId }, setBusy);
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

  async function sendMessage(text: string, hint = false) {
    if (!sessionId || busy) return;
    const key = crypto.randomUUID();
    const responseTimeMs = lastCuAt.current ? Date.now() - lastCuAt.current : 0;
    setNotice(null);
    setLines((prev) => [...prev, { turnId: `s-${key}`, from: 'student', text, kind: 'normal' }]);
    setBusy('Mít đang nghĩ');
    try {
      const r = await postSse<TurnResultDto & { timeUp?: boolean }>('/api/chat', { sessionId, text, idempotencyKey: key, hint, responseTimeMs });
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

  if (phase === 'loading') return <RestingPlaceholder />;
  if (phase === 'offline') return <RestingScreen onRetry={retry} />;
  if (phase === 'blocked') return <BlockedScreen message={blocked} />;
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
      <MessageList lines={lines} busyText={busy} />
      {notice && (
        <p className="notice err" role="alert">
          {notice}
        </p>
      )}
      {phase === 'problem' && !busy && (
        <section className="problem-entry">
          <h2>Bạn gửi đề bài cho Mít nhé</h2>
          <Composer disabled={!!busy} multiline placeholder="Gõ đề bài ở đây" submitLabel="Gửi đề" onSubmit={(t) => void sendProblem(t)} />
          <p className="or">hoặc</p>
          <PhotoProblem disabled={!!busy} onSend={(f, c) => void sendPhoto(f, c)} />
        </section>
      )}
      {phase === 'confirm' && ocr && (
        <section className="problem-entry">
          <h2>Mít đọc được đề thế này. Bạn xem đúng chưa?</h2>
          <p className="muted">Chỗ nào sai hoặc có dấu [?], bạn sửa lại cho đúng với đề nhé.</p>
          <textarea className="ocr-text" value={ocr.text} rows={4} onChange={(e) => setOcr({ ...ocr, text: e.target.value })} aria-label="Đề bài Mít đọc được" />
          <div className="composer-actions">
            <button type="button" className="ghost" onClick={() => { setOcr(null); setPhase('problem'); }}>
              Chụp lại
            </button>
            <button type="button" disabled={ocr.text.trim().length < 3} onClick={() => void sendProblem(ocr.text.trim(), ocr.problemId)}>
              Đúng rồi, bắt đầu
            </button>
          </div>
        </section>
      )}
      {phase === 'chat' && (
        <Composer
          disabled={!!busy}
          placeholder="Bạn trả lời Mít ở đây"
          submitLabel="Gửi"
          showHint
          onSubmit={(t) => void sendMessage(t)}
          onHint={() => void sendMessage('Mình cần gợi ý', true)}
        />
      )}
      {phase === 'done' && (
        <EndOfProblem
          rated={rated}
          onRate={(r) => void rate(r)}
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
