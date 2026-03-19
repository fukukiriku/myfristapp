import { createHash, randomBytes } from 'node:crypto';
import { query } from '@/lib/db';

export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface TokenRow {
  id: number;
  user_id: number;
}

export async function storeResetToken(
  userId: number,
  hashedToken: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashedToken, expiresAt]
  );
}

export async function validateResetToken(token: string): Promise<TokenRow | null> {
  const hashed = hashToken(token);
  const rows = await query<TokenRow>(
    'SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW()',
    [hashed]
  );
  return rows[0] ?? null;
}

export async function consumeResetToken(id: number): Promise<void> {
  await query('DELETE FROM password_reset_tokens WHERE id = $1', [id]);
}
