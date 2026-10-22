'use client';

import type { VoiceRecorder } from './use-voice-recorder';
import { formatClock, voiceStatusText, type SttLanguage } from './voice-input-logic';

// Phần giao diện của nhập giọng nói: nút micro lớn (cách nhập chính), chọn Tiếng Việt / English,
// dòng trạng thái đọc cho trình đọc màn hình, đồng hồ đếm ngược và thanh mức âm lượng khi đang ghi.

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

export function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const MIC_LABEL = {
  idle: { aria: 'Bấm để nói với Mít', text: 'Nói' },
  error: { aria: 'Bấm để nói với Mít', text: 'Nói' },
  requesting: { aria: 'Đang mở micro, bấm để huỷ', text: 'Chờ' },
  recording: { aria: 'Dừng ghi âm và gửi cho Mít nghe', text: 'Dừng' },
  transcribing: { aria: 'Mít đang nghe', text: 'Nghe' },
} as const;

export function MicButton({ recorder, disabled }: { recorder: VoiceRecorder; disabled: boolean }) {
  const { status } = recorder;
  const recording = status === 'recording';
  const label = MIC_LABEL[status];
  // Đang ghi hoặc đang hỏi quyền thì luôn cho bấm để dừng, kể cả khi ô nhập đang khoá.
  const canPress = recording || status === 'requesting' || (!disabled && status !== 'transcribing');
  return (
    <button
      type="button"
      className={`mic-button${recording ? ' is-recording' : ''}`}
      aria-label={label.aria}
      aria-busy={status === 'transcribing' || status === 'requesting'}
      disabled={!canPress}
      onClick={recorder.toggle}
    >
      {recording ? <StopIcon /> : <MicIcon />}
      <span aria-hidden="true">{label.text}</span>
    </button>
  );
}

const LANGUAGES: { value: SttLanguage; label: string; lang: string }[] = [
  { value: 'vi', label: 'Tiếng Việt', lang: 'vi' },
  { value: 'en', label: 'English', lang: 'en' },
];

export function VoiceBar({
  recorder,
  language,
  onLanguage,
}: {
  recorder: VoiceRecorder;
  language: SttLanguage;
  onLanguage: (language: SttLanguage) => void;
}) {
  const { status } = recorder;
  const locked = status === 'recording' || status === 'requesting' || status === 'transcribing';
  return (
    <div className="voice-bar">
      <div className="lang-toggle" role="group" aria-label="Ngôn ngữ khi nói">
        {LANGUAGES.map((l) => (
          <button key={l.value} type="button" lang={l.lang} aria-pressed={language === l.value} disabled={locked} onClick={() => onLanguage(l.value)}>
            {l.label}
          </button>
        ))}
      </div>
      <p className={`voice-status${status === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
        {voiceStatusText(status, recorder.message)}
      </p>
      {status === 'recording' && (
        <span className="voice-meter">
          <span className="voice-level" aria-hidden="true">
            <span />
          </span>
          <span className="voice-timer" role="timer" aria-live="off" aria-label={`Còn ${formatClock(recorder.msLeft)}`}>
            {formatClock(recorder.msLeft)}
          </span>
        </span>
      )}
    </div>
  );
}
