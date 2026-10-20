import { assertAdminRuntime } from '@/server/auth/session';
import { listStudentsForAdmin } from '@/server/dal/students-dal';
import { listAccounts } from '@/server/dal/users-dal';
import {
  createParentAction,
  createStudentAction,
  linkParentAction,
  recordConsentAction,
  resetPasswordAction,
  resetPinAction,
  setStudentStatusAction,
  setUserStatusAction,
  unlinkParentAction,
  unlockStudentAction,
} from './actions';

export const dynamic = 'force-dynamic';

// Trang quản trị: tạo/khoá phụ huynh, tạo hồ sơ học sinh, liên kết, reset mật khẩu/PIN, mở khoá,
// ghi nhận consent. Tạo xong là dùng được ngay (không có bước kích hoạt).
export default async function AdminHome({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const actor = await assertAdminRuntime();
  const [accounts, students, params] = await Promise.all([listAccounts(actor), listStudentsForAdmin(actor), searchParams]);
  const parents = accounts.filter((a) => a.role === 'parent');
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      {params.ok && <p className="notice ok">{params.ok}</p>}
      {params.err && <p className="notice err">{params.err}</p>}

      <section className="card">
        <h2>Tài khoản</h2>
        <table>
          <thead>
            <tr>
              <th>Tên</th>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>TOTP</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.email}</td>
                <td>{a.role}</td>
                <td>{a.status}</td>
                <td>{a.totp_secret_enc ? 'bật' : 'tắt'}</td>
                <td className="actions">
                  <form action={setUserStatusAction}>
                    <input type="hidden" name="userId" value={a.id} />
                    <input type="hidden" name="status" value={a.status === 'active' ? 'disabled' : 'active'} />
                    <button type="submit">{a.status === 'active' ? 'Khoá' : 'Mở'}</button>
                  </form>
                  <form action={resetPasswordAction}>
                    <input type="hidden" name="userId" value={a.id} />
                    <input name="password" type="password" placeholder="Mật khẩu mới" minLength={10} required />
                    <button type="submit">Đặt lại</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Tạo tài khoản phụ huynh</h3>
        <form action={createParentAction} className="inline-form">
          <input name="name" placeholder="Tên" required maxLength={100} />
          <input name="email" type="email" placeholder="Email" required />
          <input name="password" type="password" placeholder="Mật khẩu ban đầu (≥ 10 ký tự)" minLength={10} required />
          <button type="submit">Tạo</button>
        </form>
      </section>

      <section className="card">
        <h2>Học sinh</h2>
        <table>
          <thead>
            <tr>
              <th>Tên gọi</th>
              <th>Đăng nhập</th>
              <th>Lớp</th>
              <th>Gia đình</th>
              <th>Consent</th>
              <th>Phụ huynh</th>
              <th>Khoá PIN</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const locked = s.pin_lockouts.filter((l) => l.hard_locked || (l.locked_until && l.locked_until > new Date()));
              return (
                <tr key={s.id}>
                  <td>
                    <a href={`/admin/students/${s.id}/progress`}>{s.display_name}</a>
                  </td>
                  <td>{s.username}</td>
                  <td>{s.grade}</td>
                  <td>{s.is_family ? 'có' : 'ngoài gia đình'}</td>
                  <td>{s.is_family ? '—' : s.consents.length ? 'đã có' : 'CHƯA CÓ'}</td>
                  <td>
                    {s.parent_links.map((l) => (
                      <form key={l.parent_id} action={unlinkParentAction} className="chip">
                        {nameOf(l.parent_id)}
                        <input type="hidden" name="parentId" value={l.parent_id} />
                        <input type="hidden" name="studentId" value={s.id} />
                        <button type="submit" title="Gỡ liên kết">×</button>
                      </form>
                    ))}
                  </td>
                  <td>
                    {locked.length
                      ? locked.map((l) => `${l.device_class}${l.hard_locked ? ' (cứng)' : ''}`).join(', ')
                      : '—'}
                  </td>
                  <td className="actions">
                    <form action={unlockStudentAction}>
                      <input type="hidden" name="studentId" value={s.id} />
                      <button type="submit">Mở khoá PIN</button>
                    </form>
                    <form action={resetPinAction}>
                      <input type="hidden" name="studentId" value={s.id} />
                      <input name="pin" inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="PIN mới" required />
                      <button type="submit">Đặt PIN</button>
                    </form>
                    <form action={setStudentStatusAction}>
                      <input type="hidden" name="studentId" value={s.id} />
                      <input type="hidden" name="status" value={s.status === 'active' ? 'disabled' : 'active'} />
                      <button type="submit">{s.status === 'active' ? 'Khoá hồ sơ' : 'Mở hồ sơ'}</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h3>Tạo hồ sơ học sinh</h3>
        <form action={createStudentAction} className="stack-form">
          <input name="displayName" placeholder="Tên gọi (Mít gọi con bằng tên này)" required maxLength={50} />
          <input name="username" placeholder="Tên đăng nhập (không trùng tên gọi)" required pattern="[A-Za-z0-9._\-]{3,32}" />
          <input name="pin" inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="PIN 6 số" required />
          <select name="gender" required defaultValue="">
            <option value="" disabled>
              Giới tính (chỉ dùng để xưng hô)
            </option>
            <option value="male">Nam</option>
            <option value="female">Nữ</option>
          </select>
          <input name="grade" type="number" min={1} max={12} defaultValue={5} required />
          <fieldset>
            <legend>Học sinh trong gia đình?</legend>
            <label>
              <input type="radio" name="isFamily" value="true" required /> Con trong gia đình
            </label>
            <label>
              <input type="radio" name="isFamily" value="false" /> Ngoài gia đình (cần xác nhận đồng ý trước khi dùng)
            </label>
          </fieldset>
          <input name="interests" placeholder="Sở thích đã khai, cách nhau bằng dấu phẩy" maxLength={300} />
          <input name="companionName" placeholder="Tên bạn học (mặc định Mít)" maxLength={30} />
          <select name="parentId" defaultValue="">
            <option value="">— Liên kết với phụ huynh —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.email})
              </option>
            ))}
          </select>
          <button type="submit">Tạo hồ sơ</button>
        </form>

        <h3>Liên kết phụ huynh – học sinh</h3>
        <form action={linkParentAction} className="inline-form">
          <select name="parentId" required defaultValue="">
            <option value="" disabled>
              Phụ huynh
            </option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="studentId" required defaultValue="">
            <option value="" disabled>
              Học sinh
            </option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
          <button type="submit">Liên kết</button>
        </form>
      </section>

      <section className="card">
        <h2>Ghi nhận xác nhận đồng ý (học sinh ngoài gia đình)</h2>
        <form action={recordConsentAction} className="stack-form">
          <select name="studentId" required defaultValue="">
            <option value="" disabled>
              Học sinh
            </option>
            {students
              .filter((s) => !s.is_family)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
          </select>
          <select name="parentId" required defaultValue="">
            <option value="" disabled>
              Phụ huynh ký
            </option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input name="version" placeholder="Phiên bản văn bản (vd. v1)" required maxLength={20} />
          <textarea name="textSnapshot" rows={5} placeholder="Nội dung văn bản đồng ý đã ký" required />
          <input name="signedAt" type="date" required />
          <label>
            <input type="checkbox" name="childAcknowledged" /> Con (từ 7 tuổi) đã được giải thích và xác nhận
          </label>
          <label>
            Ảnh/bản scan văn bản (PDF, JPEG, PNG ≤ 10 MB)
            <input name="document" type="file" accept="application/pdf,image/jpeg,image/png" />
          </label>
          <button type="submit">Ghi nhận</button>
        </form>
      </section>
    </>
  );
}
