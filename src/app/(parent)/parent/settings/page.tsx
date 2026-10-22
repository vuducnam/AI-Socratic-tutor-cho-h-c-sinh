import { newTotpSecret, totpUri } from '@/server/auth/totp';
import { requireParentActor } from '@/server/auth/session';
import { MIN_PASSWORD_LENGTH } from '@/server/auth/password';
import { getStudentProfile } from '@/server/dal/students-dal';
import { getOwnAccount } from '@/server/dal/users-dal';
import { readVoicePrefs } from '@/server/dal/voice-prefs-dal';
import { ChildTabs, Notices } from '../_components/child-tabs';
import { loadSelectedChild } from '../_lib/parent-page-helpers';
import { changePasswordAction, disableTotpAction, enableTotpAction, updatePreferencesAction, updateVoicePrefsAction } from './actions';

export const dynamic = 'force-dynamic';

function numberPref(prefs: unknown, key: string, fallback: number): number {
  const value = prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>)[key] : undefined;
  return typeof value === 'number' ? value : fallback;
}

// Cấu hình (SPEC §11.1): hồ sơ của con (sở thích đã khai, thời lượng), giọng nói (tự đọc, ngôn ngữ nói,
// STT dự phòng qua dịch vụ ngoài) và tài khoản của phụ huynh (đổi mật khẩu, bật/tắt TOTP).
export default async function ParentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; ok?: string; err?: string; totpSetup?: string }>;
}) {
  const actor = await requireParentActor();
  const query = await searchParams;
  const [{ children, selected }, account] = await Promise.all([loadSelectedChild(actor, query.studentId), getOwnAccount(actor)]);
  const profile = selected ? await getStudentProfile(actor, { studentId: selected.id }) : null;
  const voice = profile ? readVoicePrefs(profile.learning_prefs) : null;
  // Secret mới chỉ sinh khi phụ huynh bấm bật; được xác nhận bằng mã 6 số trước khi lưu.
  const setupSecret = query.totpSetup === '1' && !account.totp_secret_enc ? newTotpSecret() : null;

  return (
    <>
      <h1>Cấu hình</h1>
      <Notices ok={query.ok} err={query.err} />

      {selected && profile && (
        <section className="card">
          <ChildTabs basePath="/parent/settings" items={children} selectedId={selected.id} />
          <h2>Hồ sơ của {profile.display_name}</h2>
          <p className="muted small">
            Lớp {profile.grade} · preset {profile.preset}
          </p>
          <form action={updatePreferencesAction} className="stack-form">
            <input type="hidden" name="studentId" value={profile.id} />
            <label>
              Sở thích của con (cách nhau bởi dấu phẩy, tối đa 10)
              <input name="interests" defaultValue={profile.interests_declared.join(', ')} maxLength={500} />
            </label>
            <label>
              Thời lượng một phiên (phút)
              <input type="number" name="sessionMinutes" min={5} max={60} required defaultValue={numberPref(profile.learning_prefs, 'session_minutes', 15)} />
            </label>
            <label>
              Giới hạn mỗi ngày (phút)
              <input
                type="number"
                name="dailyLimitMinutes"
                min={5}
                max={180}
                required
                defaultValue={numberPref(profile.learning_prefs, 'daily_limit_minutes', 30)}
              />
            </label>
            <button type="submit">Lưu hồ sơ</button>
          </form>
        </section>
      )}

      {selected && profile && voice && (
        <section className="card">
          <h2>Giọng nói của {profile.display_name}</h2>
          <form action={updateVoicePrefsAction} className="stack-form">
            <input type="hidden" name="studentId" value={profile.id} />
            <label className="checkbox">
              <input type="checkbox" name="ttsAutoplay" defaultChecked={voice.ttsAutoplay} /> Mít tự đọc câu trả lời
            </label>
            <label>
              Ngôn ngữ nói mặc định
              <select name="sttLanguage" defaultValue={voice.sttLanguage}>
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" name="sttCloudFallback" defaultChecked={voice.sttCloudFallback} /> Cho phép gửi giọng nói lên dịch
              vụ ngoài khi máy ở nhà lỗi (mặc định tắt)
            </label>
            <p className="muted small">
              Bình thường giọng của con chỉ được chuyển thành chữ trên máy ở nhà và xoá ngay sau đó. Khi bật, nếu máy ở nhà lỗi, đoạn
              ghi âm được gửi tới OpenRouter để chuyển thành chữ; mỗi lần gửi đều có trong lịch sử gọi model của phiên.
            </p>
            <button type="submit">Lưu cài đặt giọng nói</button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Đổi mật khẩu</h2>
        <form action={changePasswordAction} className="stack-form">
          <label>
            Mật khẩu hiện tại
            <input type="password" name="currentPassword" autoComplete="current-password" required />
          </label>
          <label>
            Mật khẩu mới (ít nhất {MIN_PASSWORD_LENGTH} ký tự)
            <input type="password" name="newPassword" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          </label>
          <label>
            Nhập lại mật khẩu mới
            <input type="password" name="confirmPassword" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          </label>
          <button type="submit">Đổi mật khẩu</button>
        </form>
      </section>

      <section className="card">
        <h2>Xác thực hai lớp (TOTP)</h2>
        {account.totp_secret_enc ? (
          <>
            <p>Đang bật. Mỗi lần đăng nhập cần mã 6 số từ ứng dụng xác thực.</p>
            <form action={disableTotpAction} className="stack-form">
              <label>
                Mật khẩu hiện tại để tắt
                <input type="password" name="currentPassword" autoComplete="current-password" required />
              </label>
              <button type="submit">Tắt TOTP</button>
            </form>
          </>
        ) : setupSecret ? (
          <form action={enableTotpAction} className="stack-form">
            <p>Thêm tài khoản vào ứng dụng xác thực bằng địa chỉ dưới đây (hoặc nhập khoá thủ công), rồi nhập mã 6 số đang hiện.</p>
            <label>
              Địa chỉ otpauth
              <textarea readOnly rows={3} value={totpUri(setupSecret, account.email)} />
            </label>
            <p>
              Khoá: <code>{setupSecret}</code>
            </p>
            <input type="hidden" name="secret" value={setupSecret} />
            <label>
              Mã 6 số
              <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required />
            </label>
            <button type="submit">Xác nhận và bật</button>
          </form>
        ) : (
          <>
            <p>Đang tắt. Nên bật vì app mở trên internet.</p>
            <p>
              <a href="/parent/settings?totpSetup=1">Bật TOTP</a>
            </p>
          </>
        )}
      </section>
    </>
  );
}
