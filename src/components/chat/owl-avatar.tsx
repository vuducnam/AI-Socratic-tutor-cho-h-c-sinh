// Cú — bạn học của con. SVG vẽ tay bằng code (không dùng ảnh sinh), trang trí nên aria-hidden.
export function OwlAvatar({ size = 48, mood = 'calm' }: { size?: number; mood?: 'calm' | 'thinking' | 'resting' }) {
  const eyesOpen = mood !== 'resting';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="owl">
      <path d="M14 22 L18 8 L26 18 Z M50 22 L46 8 L38 18 Z" fill="var(--owl-dark)" />
      <ellipse cx="32" cy="36" rx="22" ry="24" fill="var(--owl-body)" />
      <ellipse cx="32" cy="44" rx="13" ry="13" fill="var(--owl-belly)" />
      <circle cx="23" cy="30" r="9" fill="var(--owl-face)" />
      <circle cx="41" cy="30" r="9" fill="var(--owl-face)" />
      {eyesOpen ? (
        <>
          <circle cx={mood === 'thinking' ? 25 : 23} cy={mood === 'thinking' ? 28 : 30} r="4" fill="var(--owl-eye)" />
          <circle cx={mood === 'thinking' ? 43 : 41} cy={mood === 'thinking' ? 28 : 30} r="4" fill="var(--owl-eye)" />
        </>
      ) : (
        <path d="M18 31 Q23 34 28 31 M36 31 Q41 34 46 31" stroke="var(--owl-eye)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      )}
      <path d="M29 36 L32 41 L35 36 Z" fill="var(--owl-beak)" />
    </svg>
  );
}
