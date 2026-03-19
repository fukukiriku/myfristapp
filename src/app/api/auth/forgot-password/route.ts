import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { query } from '@/lib/db';
import { forgotPasswordSchema } from '@/lib/auth/validation';
import { generateResetToken, hashToken, storeResetToken } from '@/lib/auth/reset-token';
import { sendPasswordResetEmail } from '@/lib/email';

interface UserRow {
  id: number;
  email: string;
}

export async function POST(request: Request) {
  const body = await request.json();
  const result = forgotPasswordSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0].message },
      { status: 400 }
    );
  }

  const { email } = result.data;
  const [user] = await query<UserRow>(
    'SELECT id, email FROM users WHERE email = $1',
    [email]
  );

  if (user) {
    const token = generateResetToken();
    const hashedToken = hashToken(token);
    await storeResetToken(user.id, hashedToken);

    const headerStore = await headers();
    const host = headerStore.get('host') ?? 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}`;

    await sendPasswordResetEmail(email, token, baseUrl);
  }

  return NextResponse.json({ message: '如果该邮箱已注册，重置链接已发送。' });
}
