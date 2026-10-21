'use client';

import { useEffect, useRef, useState } from 'react';
import { pickAutoplayIds, silentWavDataUri } from './tts-playback-logic';

// Mít đọc to tin của mình qua POST /api/tts {turnId} → audio/wav. Mỗi lúc chỉ một tiếng.
// Tự đọc chỉ chạy sau khi con đã chạm/bấm trên trang (luật autoplay của trình duyệt), mỗi lượt đúng một lần.
// Server báo không có tiếng (404/503/...) → ẩn nút nghe của lượt đó, không báo lỗi cho con.

export interface TtsPlayer {
  activeId: string | null;
  loading: boolean;
  unavailable: ReadonlySet<string>;
  toggle: (turnId: string) => void;
  autoplay: (turnIds: readonly string[]) => void;
  stop: () => void;
}

export function useTtsPlayer(): TtsPlayer {
  const [active, setActiveState] = useState<{ id: string; loading: boolean } | null>(null);
  // Bản sao trong ref: autoplay được gọi từ callback cũ (sau khi chờ server), không được đọc state cũ.
  const activeRef = useRef(active);
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Tiếng của Mít (không phải dữ liệu của con) được giữ trong phiên để nghe lại không phải tải lại.
  const cache = useRef(new Map<string, string>());
  const queue = useRef<string[]>([]);
  // Mỗi lần dừng/phát mới tăng token; kết quả tải về của lần cũ bị bỏ qua.
  const token = useRef(0);
  const gestured = useRef(false);
  const autoplayed = useRef(new Set<string>());
  const unavailableRef = useRef(unavailable);

  function setActive(next: { id: string; loading: boolean } | null) {
    activeRef.current = next;
    setActiveState(next);
  }

  function getAudio(): HTMLAudioElement {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }

  function markUnavailable(id: string) {
    const next = new Set(unavailableRef.current).add(id);
    unavailableRef.current = next;
    setUnavailable(next);
  }

  function advance(t: number) {
    if (t !== token.current) return;
    const nextId = queue.current.shift();
    if (nextId) void playOne(nextId, t);
    else setActive(null);
  }

  async function playOne(id: string, t: number) {
    setActive({ id, loading: true });
    let url = cache.current.get(id);
    if (!url) {
      let blob: Blob | null = null;
      try {
        const res = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId: id }) });
        if (res.ok) blob = await res.blob();
        else markUnavailable(id);
      } catch {
        // Mất mạng: im lặng dừng, nút nghe vẫn còn để con thử lại.
        if (t === token.current) {
          queue.current = [];
          setActive(null);
        }
        return;
      }
      if (!blob || blob.size === 0) {
        if (blob) markUnavailable(id);
        return advance(t);
      }
      url = URL.createObjectURL(blob);
      cache.current.set(id, url);
    }
    if (t !== token.current) return;
    const audio = getAudio();
    audio.onended = () => advance(t);
    audio.onerror = () => {
      if (t !== token.current) return;
      markUnavailable(id);
      advance(t);
    };
    audio.src = url;
    try {
      await audio.play();
    } catch {
      // Trình duyệt chặn tự phát hoặc bị ngắt bởi lần phát mới: không báo lỗi cho con.
      if (t === token.current) {
        queue.current = [];
        setActive(null);
      }
      return;
    }
    if (t === token.current) setActive({ id, loading: false });
  }

  function stop() {
    token.current++;
    queue.current = [];
    audioRef.current?.pause();
    setActive(null);
  }

  function toggle(turnId: string) {
    if (activeRef.current?.id === turnId) return stop();
    stop();
    void playOne(turnId, token.current);
  }

  function autoplay(turnIds: readonly string[]) {
    const ids = pickAutoplayIds(turnIds, autoplayed.current, unavailableRef.current);
    ids.forEach((id) => autoplayed.current.add(id));
    const [first, ...rest] = ids;
    if (!first || !gestured.current) return;
    if (activeRef.current) {
      queue.current.push(...ids); // đang đọc tin trước: đọc tiếp sau đó
      return;
    }
    const t = ++token.current;
    queue.current = rest;
    void playOne(first, t);
  }

  useEffect(() => {
    const audio = getAudio();
    const urls = cache.current;
    const silent = silentWavDataUri();
    // Lần chạm đầu tiên: phát một đoạn im lặng để Safari/iPadOS cho phép tự đọc các tin sau.
    const onGesture = () => {
      document.removeEventListener('click', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      gestured.current = true;
      if (audio.getAttribute('src')) return;
      const t = token.current;
      audio.src = silent;
      audio
        .play()
        .then(() => {
          if (t === token.current) audio.pause();
        })
        .catch(() => undefined);
    };
    document.addEventListener('click', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    return () => {
      document.removeEventListener('click', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- token là bộ đếm (không phải DOM node), cần giá trị mới nhất khi rời trang
      token.current++;
      audio.pause();
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
    // Chỉ gắn một lần khi mở màn hình chat.
  }, []);

  return { activeId: active?.id ?? null, loading: active?.loading ?? false, unavailable, toggle, autoplay, stop };
}
