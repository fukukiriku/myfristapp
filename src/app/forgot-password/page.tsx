'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const email = (
      e.currentTarget.elements.namedItem('email') as HTMLInputElement
    ).value;

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (res.ok) {
      setSubmitted(true);
    } else {
      const data = await res.json();
      setError(data.error || '发送失败，请稍后重试');
    }
    setLoading(false);
  }

  if (submitted) {
    return (
      <main style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
        <h1>查收邮件</h1>
        <p>
          如果该邮箱已注册，我们已发送重置密码邮件。请查收（开发环境请看
          server 终端输出）。
        </p>
        <p>
          <Link href="/login">返回登录</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
      <h1>忘记密码</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="email">注册邮箱</label>
          <br />
          <input
            id="email"
            name="email"
            type="email"
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: 10 }}
        >
          {loading ? '发送中...' : '发送重置链接'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link href="/login">返回登录</Link>
      </p>
    </main>
  );
}
