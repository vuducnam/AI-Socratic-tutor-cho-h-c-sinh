'use client';

import { useState } from 'react';
import { LoginForm } from '@/components/auth/login-form';

export function LoginTabs() {
  const [mode, setMode] = useState<'student' | 'parent'>('student');
  return (
    <div className="card">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'student'} onClick={() => setMode('student')}>
          Học sinh
        </button>
        <button role="tab" aria-selected={mode === 'parent'} onClick={() => setMode('parent')}>
          Bố mẹ
        </button>
      </div>
      <LoginForm key={mode} mode={mode} />
    </div>
  );
}
