import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { hashPassword } from '@/lib/auth/password';
import { validateResetToken, hashToken } from '@/lib/auth/reset-token';
import { resetPasswordSchema } from '@/lib/auth/validation';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(request: Request) {
  const body = await request.json();

  // resetPasswordSchema 含 confirmPassword refine，API 层利用其校验
  // 但只向 DB 传 token + password
  const result = resetPasswordSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0].message },
      { status: 400 }
    );
  }

  const { token, password } = result.data;

  const tokenRow = await validateResetToken(token);
  if (!tokenRow) {
    return NextResponse.json(
      { error: '重置链接无效或已过期' },
      { status: 400 }
    );
  }

  const newPasswordHash = await hashPassword(password);
  const hashedToken = hashToken(token);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, tokenRow.user_id]
    );
    await client.query(
      'DELETE FROM password_reset_tokens WHERE token_hash = $1',
      [hashedToken]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return NextResponse.json({ message: '密码已重置，请重新登录。' });
}
