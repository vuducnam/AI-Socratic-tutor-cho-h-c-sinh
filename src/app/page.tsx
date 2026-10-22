import { redirect } from 'next/navigation';

// Không có trang giới thiệu công khai (SPEC §14b): gốc luôn chuyển tới đăng nhập.
export default function Home() {
  redirect('/login');
}
