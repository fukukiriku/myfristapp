import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { createToken, setSessionCookie } from '@/lib/auth/session';
import { registerSchema } from '@/lib/auth/validation';

interface UserRow {
  id: number;
  email: string;
}

export async function POST(request: Request) {
  const body = await request.json();
  const result = registerSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const { email, password } = result.data;

  const existing = await query<UserRow>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.length > 0) {
    return NextResponse.json({ error: '该邮箱已被注册' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await query<UserRow>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
    [email, passwordHash]
  );

  const token = await createToken(user.id, user.email);
  await setSessionCookie(token);

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
