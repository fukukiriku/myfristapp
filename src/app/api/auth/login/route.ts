import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createToken, setSessionCookie } from '@/lib/auth/session';
import { loginSchema } from '@/lib/auth/validation';

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
}

export async function POST(request: Request) {
  const body = await request.json();
  const result = loginSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const { email, password } = result.data;

  const [user] = await query<UserRow>(
    'SELECT id, email, password_hash FROM users WHERE email = $1',
    [email]
  );

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 });
  }

  const token = await createToken(user.id, user.email);
  await setSessionCookie(token);

  return NextResponse.json({ id: user.id, email: user.email });
}
