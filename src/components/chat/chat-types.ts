// Kiểu dữ liệu phía client của /learn (khớp JSON từ /api/learn/*, /api/chat — không import từ src/server).

export interface Visual {
  kind: 'segment_bar' | 'fraction_grid' | 'number_line' | 'box';
  items: { label: string; value: number; unit: string }[];
}

export interface ChatLine {
  turnId: string;
  from: 'cu' | 'student';
  text: string;
  kind: string;
  visual?: Visual | null;
}

export interface TurnResultDto {
  studentTurnId: string | null;
  tutorTurnId: string;
  message: string;
  before?: { turnId: string; content: string; kind: string }[];
  visual?: Visual | null;
  state: string;
  scaffoldLevel: number;
  done: boolean;
  paused: boolean;
}

export type StartDto =
  | { ok: true; sessionId: string; lines: ChatLine[]; state: string | null; hasProblem: boolean; minutesLeft: number }
  | { ok: false; reason: string; message: string };

export type ProblemResultDto = { ok: true; turn: TurnResultDto } | { ok: false; message: string; reason: string };

/** Lượt Cú → các dòng hiển thị (câu mở chuyện đời trước, rồi tin chính). */
export function linesFromTurn(turn: TurnResultDto): ChatLine[] {
  return [
    ...(turn.before ?? []).map((b) => ({ turnId: b.turnId, from: 'cu' as const, text: b.content, kind: b.kind })),
    { turnId: turn.tutorTurnId, from: 'cu', text: turn.message, kind: 'normal', visual: turn.visual ?? null },
  ];
}

/** Cài đặt giọng nói của con do phụ huynh đặt (trang server truyền xuống; client không import src/server). */
export interface ClientVoicePrefs {
  ttsAutoplay: boolean;
  sttLanguage: 'vi' | 'en';
}
