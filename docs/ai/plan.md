# 忘记密码 + 重置密码 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已有邮箱/密码登录系统增加"忘记密码"和"重置密码"功能，让用户能通过邮件链接安全地重置密码。

**Architecture:** 用户提交邮箱 → 后端生成随机 token 并存入数据库（hashed）→ 控制台打印重置链接（开发环境）→ 用户访问链接提交新密码 → 后端验证 token 有效性、更新密码、删除 token。Token 有 1 小时有效期，使用后立即失效（one-time use）。

**Tech Stack:** Next.js 16 App Router, TypeScript, PostgreSQL (pg), bcryptjs, zod, Node.js `crypto` 模块（生成 token，无需额外依赖）

> **安全说明：** 忘记密码接口无内置速率限制，上线前需在反向代理（nginx/Cloudflare）或 Next.js middleware 层添加限流，防止邮件轰炸攻击。

---

## 文件结构

| 状态 | 文件 | 职责 |
|------|------|------|
| 新建 | `sql/002_add_password_reset_tokens.sql` | DB migration：创建 password_reset_tokens 表 |
| 新建 | `src/lib/auth/reset-token.ts` | Token 生成、存储、验证、消费的纯函数 |
| 新建 | `src/lib/email.ts` | 邮件发送抽象（开发环境打印到控制台） |
| 修改 | `src/lib/auth/validation.ts` | 新增 forgotPasswordSchema、resetPasswordSchema |
| 新建 | `src/app/api/auth/forgot-password/route.ts` | POST API：接收邮箱，生成并存储 token |
| 新建 | `src/app/api/auth/reset-password/route.ts` | POST API：验证 token，更新密码 |
| 新建 | `src/app/forgot-password/page.tsx` | 忘记密码 UI：邮箱表单 + 成功状态 |
| 新建 | `src/app/reset-password/page.tsx` | 重置密码 UI：新密码表单 + token 错误处理 |
| 修改 | `src/app/login/page.tsx` | 添加"忘记密码？"链接 |

---

## Task 1: DB Migration — password_reset_tokens 表

**预计时间：30 分钟**

**文件：**
- 新建：`sql/002_add_password_reset_tokens.sql`

**验收标准：**
- `\d password_reset_tokens` 显示表结构：id, user_id (FK→users), token_hash (UNIQUE), expires_at, created_at
- user_id 外键在用户删除时级联删除

---

- [ ] **Step 1: 创建 migration SQL 文件**

> 注：统一使用 `sql/` 目录（与 `sql/001_create_users.sql` 同级）。`token_hash` 设置 UNIQUE，UNIQUE 约束自动创建隐式索引，无需额外 CREATE INDEX。

```sql
-- sql/002_add_password_reset_tokens.sql
CREATE TABLE password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: 执行 migration**

```bash
# 从 .env.local 读取连接串，不依赖 shell export
DB_URL=$(grep '^DATABASE_URL=' .env.local | cut -d '=' -f2-)
psql "$DB_URL" -f sql/002_add_password_reset_tokens.sql
```

预期输出：
```
CREATE TABLE
```

- [ ] **Step 3: 验证表结构**

```bash
DB_URL=$(grep '^DATABASE_URL=' .env.local | cut -d '=' -f2-)
psql "$DB_URL" -c "\d password_reset_tokens"
```

预期：显示 id, user_id, token_hash, expires_at, created_at 五列，token_hash 有 unique 约束标注。

- [ ] **Step 4: Commit**

```bash
git add sql/002_add_password_reset_tokens.sql
git commit -m "feat: add password_reset_tokens migration"
```

---

## Task 2: Token 工具函数 + Validation Schemas

**预计时间：45 分钟**

**文件：**
- 新建：`src/lib/auth/reset-token.ts`
- 修改：`src/lib/auth/validation.ts`

**验收标准：**
- `generateResetToken()` 返回 64 字符十六进制字符串（每次不同）
- `hashToken(token)` 对同一 token 每次返回相同 hash
- `storeResetToken(userId, hashedToken)` 在 DB 中插入一行，expires_at 为 1 小时后
- `validateResetToken(token)` 对有效 token 返回 `{ id, userId }`，对无效/过期 token 返回 null
- `consumeResetToken(id)` 删除该行
- zod schemas 正确导出并类型推断正确

---

- [ ] **Step 1: 创建 `src/lib/auth/reset-token.ts`**

```typescript
import crypto from 'crypto';
import { query } from '@/lib/db';

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

interface TokenRow {
  id: number;
  user_id: number;
}

export async function storeResetToken(userId: number, hashedToken: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
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
```

- [ ] **Step 2: 在 `src/lib/auth/validation.ts` 末尾追加 schemas**

```typescript
export const forgotPasswordSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token 不能为空'),
  password: z.string().min(8, '密码至少 8 个字符'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
```

- [ ] **Step 3: 手动验证 token 函数（在 Node REPL 或临时脚本中）**

```bash
node -e "
const crypto = require('crypto');
const t = crypto.randomBytes(32).toString('hex');
console.log('token length:', t.length); // 应为 64
const h1 = crypto.createHash('sha256').update(t).digest('hex');
const h2 = crypto.createHash('sha256').update(t).digest('hex');
console.log('hashes equal:', h1 === h2); // 应为 true
"
```

预期输出：`token length: 64`，`hashes equal: true`

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/reset-token.ts src/lib/auth/validation.ts
git commit -m "feat: add reset token utilities and validation schemas"
```

---

## Task 3: 邮件发送服务（开发环境 console 版）

**预计时间：30 分钟**

**文件：**
- 新建：`src/lib/email.ts`

**验收标准：**
- 调用 `sendPasswordResetEmail('test@example.com', 'abc123', 'http://localhost:3000')` 后，控制台打印出包含 `/reset-password?token=abc123` 的 URL
- 函数签名清晰，未来可替换为真实邮件服务

---

- [ ] **Step 1: 创建 `src/lib/email.ts`**

```typescript
export async function sendPasswordResetEmail(
  email: string,
  token: string,
  baseUrl: string
): Promise<void> {
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  if (process.env.NODE_ENV !== 'production') {
    console.log('------------------------------------');
    console.log('[DEV] 密码重置邮件');
    console.log(`收件人: ${email}`);
    console.log(`重置链接: ${resetUrl}`);
    console.log('------------------------------------');
    return;
  }

  // TODO: 接入真实邮件服务（如 Resend、Nodemailer）
  throw new Error('生产环境邮件服务尚未配置');
}
```

- [ ] **Step 2: 在终端验证（启动 dev server 后用 curl 触发，或直接用 node 脚本）**

```bash
node -e "
process.env.NODE_ENV = 'development';
// 因为是 TypeScript，实际验证在 Step 4 通过 API 路由触发
console.log('逻辑检查通过：NODE_ENV !== production 时走 console.log 分支');
"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add email service stub (console log in dev)"
```

---

## Task 4: API Route — POST /api/auth/forgot-password

**预计时间：45 分钟**

**文件：**
- 新建：`src/app/api/auth/forgot-password/route.ts`

**验收标准：**
- 发送已注册邮箱 → 200，DB 中存在新 token 行，控制台打印重置链接
- 发送未注册邮箱 → 200（防止邮箱枚举攻击，不暴露用户是否存在）
- 发送格式错误的邮箱 → 400 + 错误消息

---

- [ ] **Step 1: 创建 `src/app/api/auth/forgot-password/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { forgotPasswordSchema } from '@/lib/auth/validation';
import { generateResetToken, hashToken, storeResetToken } from '@/lib/auth/reset-token';
import { sendPasswordResetEmail } from '@/lib/email';
import { headers } from 'next/headers';

interface UserRow {
  id: number;
  email: string;
}

export async function POST(request: Request) {
  const body = await request.json();
  const result = forgotPasswordSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const { email } = result.data;

  const [user] = await query<UserRow>('SELECT id, email FROM users WHERE email = $1', [email]);

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

  // 无论用户是否存在，都返回相同响应（防枚举）
  return NextResponse.json({ message: '如果该邮箱已注册，重置链接已发送。' });
}
```

- [ ] **Step 2: 启动 dev server**

```bash
npm run dev
```

- [ ] **Step 3: 用 curl 测试已注册邮箱**

```bash
curl -s -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"your-registered-email@example.com"}'
```

预期：响应 `{"message":"如果该邮箱已注册，重置链接已发送。"}`，终端打印重置链接。

- [ ] **Step 4: 测试未注册邮箱**

```bash
curl -s -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com"}'
```

预期：响应同样为 `{"message":"如果该邮箱已注册，重置链接已发送。"}`（无法区分）。

- [ ] **Step 5: 测试格式错误邮箱**

```bash
curl -s -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email"}'
```

预期：`{"error":"请输入有效的邮箱地址"}` + HTTP 400。

- [ ] **Step 6: 验证 DB 中存在 token**

```bash
psql $DATABASE_URL -c "SELECT id, user_id, expires_at FROM password_reset_tokens;"
```

预期：显示刚插入的行。

- [ ] **Step 7: Commit**

```bash
git add src/app/api/auth/forgot-password/route.ts
git commit -m "feat: add forgot-password API route"
```

---

## Task 5: API Route — POST /api/auth/reset-password

**预计时间：45 分钟**

**文件：**
- 新建：`src/app/api/auth/reset-password/route.ts`

**验收标准：**
- 有效 token + 新密码（≥8字符）→ 200，users 表密码已更新，password_reset_tokens 行已删除
- 无效 token → 400 `{"error":"重置链接无效或已过期"}`
- 已过期 token（expires_at < NOW()）→ 400 `{"error":"重置链接无效或已过期"}`
- 密码太短 → 400 zod 校验错误

---

- [ ] **Step 1: 创建 `src/app/api/auth/reset-password/route.ts`**

> ⚠️ 密码更新和 token 删除必须在同一事务中完成，否则其中一步失败会导致数据不一致。

```typescript
import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { hashPassword } from '@/lib/auth/password';
import { validateResetToken, hashToken } from '@/lib/auth/reset-token';
import { resetPasswordSchema } from '@/lib/auth/validation';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(request: Request) {
  const body = await request.json();
  const result = resetPasswordSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.issues[0].message }, { status: 400 });
  }

  const { token, password } = result.data;

  const tokenRow = await validateResetToken(token);
  if (!tokenRow) {
    return NextResponse.json({ error: '重置链接无效或已过期' }, { status: 400 });
  }

  const newPasswordHash = await hashPassword(password);
  const hashedToken = hashToken(token);

  // 在事务中完成密码更新和 token 删除，保证原子性
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, tokenRow.user_id]);
    await client.query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [hashedToken]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return NextResponse.json({ message: '密码已重置，请重新登录。' });
}
```

- [ ] **Step 2: 从 Task 4 的控制台日志中复制 token，测试有效 token**

```bash
# 把 TOKEN 替换为控制台打印的实际 token
curl -s -X POST http://localhost:3000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"TOKEN","password":"newpassword123"}'
```

预期：`{"message":"密码已重置，请重新登录。"}`

- [ ] **Step 3: 验证密码已更新、token 已删除**

```bash
# token 应已删除
psql $DATABASE_URL -c "SELECT COUNT(*) FROM password_reset_tokens;"
# 用新密码登录
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@example.com","password":"newpassword123"}'
```

预期：token 表为空；登录返回 `{"id":...,"email":"..."}` + Set-Cookie。

- [ ] **Step 4: 测试无效 token**

```bash
curl -s -X POST http://localhost:3000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"invalidtoken","password":"newpassword123"}'
```

预期：`{"error":"重置链接无效或已过期"}` + HTTP 400。

- [ ] **Step 5: 测试密码太短**

```bash
curl -s -X POST http://localhost:3000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"anytoken","password":"short"}'
```

预期：`{"error":"密码至少 8 个字符"}` + HTTP 400。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/auth/reset-password/route.ts
git commit -m "feat: add reset-password API route"
```

---

## Task 6: UI — /forgot-password 页面 + Login 页链接

**预计时间：45 分钟**

**文件：**
- 新建：`src/app/forgot-password/page.tsx`
- 修改：`src/app/login/page.tsx`

**验收标准：**
- 访问 `/forgot-password` 显示邮箱输入表单
- 提交任意邮箱后显示成功提示文案（不暴露邮箱是否存在）
- 提交空邮箱或格式错误邮箱显示错误提示
- 登录页有"忘记密码？"链接，点击跳转到 `/forgot-password`
- 忘记密码页有"返回登录"链接

---

- [ ] **Step 1: 创建 `src/app/forgot-password/page.tsx`**

```tsx
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

    const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value;

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
        <p>如果该邮箱已注册，我们已发送重置密码邮件。请查收（含开发环境的控制台）。</p>
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
        <button type="submit" disabled={loading} style={{ width: '100%', padding: 10 }}>
          {loading ? '发送中...' : '发送重置链接'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link href="/login">返回登录</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: 在 `src/app/login/page.tsx` 中添加"忘记密码？"链接**

找到登录页的"没有账号？"段落，在它上方添加：

```tsx
<p style={{ marginTop: 8 }}>
  <Link href="/forgot-password">忘记密码？</Link>
</p>
```

具体位置：在 `</form>` 之后、已有的 `<p>没有账号？...` 之前插入。

- [ ] **Step 3: 浏览器验证**

1. 访问 `http://localhost:3000/login` → 页面底部出现"忘记密码？"链接
2. 点击链接 → 跳转到 `/forgot-password`，显示邮箱表单
3. 输入已注册邮箱，点击"发送重置链接" → 显示成功文案；dev server 终端打印重置链接
4. 输入未注册邮箱，点击提交 → 显示相同成功文案（不暴露信息）
5. 点击"返回登录" → 跳回 `/login`

- [ ] **Step 4: Commit**

```bash
git add src/app/forgot-password/page.tsx src/app/login/page.tsx
git commit -m "feat: add forgot-password page and link from login"
```

---

## Task 7: UI — /reset-password 页面

**预计时间：45 分钟**

**文件：**
- 新建：`src/app/reset-password/page.tsx`

**验收标准：**
- 访问 `/reset-password?token=VALID_TOKEN` → 显示新密码表单
- 提交有效 token + 新密码（≥8字符）→ 成功提示 + "前往登录"链接
- 提交两次密码不一致 → 客户端错误提示（无需后端往返）
- 提交无效/过期 token → 显示"重置链接无效或已过期"错误
- 访问无 token 的 `/reset-password` → 提示 token 缺失

---

- [ ] **Step 1: 创建 `src/app/reset-password/page.tsx`**

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <main style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
        <h1>重置密码</h1>
        <p style={{ color: 'red' }}>重置链接无效，请重新申请。</p>
        <Link href="/forgot-password">重新申请</Link>
      </main>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    const form = e.currentTarget;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    const confirmPassword = (form.elements.namedItem('confirmPassword') as HTMLInputElement).value;

    if (password !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });

    if (res.ok) {
      setSuccess(true);
    } else {
      const data = await res.json();
      setError(data.error || '重置失败，请稍后重试');
    }
    setLoading(false);
  }

  if (success) {
    return (
      <main style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
        <h1>密码已重置</h1>
        <p>您的密码已成功更新，请使用新密码登录。</p>
        <Link href="/login">前往登录</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
      <h1>重置密码</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="password">新密码</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="confirmPassword">确认新密码</label>
          <br />
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: '100%', padding: 10 }}>
          {loading ? '重置中...' : '重置密码'}
        </button>
      </form>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div>加载中...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
```

- [ ] **Step 2: 从 dev server 终端获取有效 token（重新申请一个）**

```bash
curl -s -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"your-registered-email@example.com"}'
# 终端会打印：重置链接: http://localhost:3000/reset-password?token=XXXXX
```

- [ ] **Step 3: 浏览器验证 — 有效 token**

1. 访问终端打印的重置链接（含 `?token=...`）
2. 输入新密码和确认密码（一致，≥8字符），点击"重置密码"
3. 显示"密码已重置"成功页，点击"前往登录"
4. 用新密码登录 → 成功进入 dashboard

- [ ] **Step 4: 浏览器验证 — 两次密码不一致**

1. 重新申请一个 token，访问重置链接
2. 输入两个不同的密码 → 出现"两次密码输入不一致"错误提示（无网络请求）

- [ ] **Step 5: 浏览器验证 — 无效/已用 token**

1. 访问 `http://localhost:3000/reset-password?token=fakeinvalidtoken`
2. 输入任意有效密码 → 显示"重置链接无效或已过期"

- [ ] **Step 6: 浏览器验证 — 无 token**

1. 访问 `http://localhost:3000/reset-password`（无 query string）
2. 直接显示"重置链接无效，请重新申请"

- [ ] **Step 7: Commit**

```bash
git add src/app/reset-password/page.tsx
git commit -m "feat: add reset-password page"
```

---

## 完整流程端到端验收

完成所有 Task 后，执行以下完整流程验证：

1. 访问 `/login` → 点击"忘记密码？" → 进入 `/forgot-password`
2. 输入已注册邮箱 → 点击"发送重置链接" → 看到成功提示
3. 从 dev server 终端复制重置链接，在浏览器打开
4. 输入新密码（两次一致）→ 点击"重置密码" → 看到成功页
5. 点击"前往登录" → 用新密码登录 → 成功进入 dashboard
6. 再次用旧密码登录 → 失败（"邮箱或密码错误"）
7. 尝试再次访问同一重置链接并提交 → 失败（token 已消费）
