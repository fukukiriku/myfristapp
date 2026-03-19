# Todo — 忘记密码 + 重置密码

> 详细实现步骤见 [plan.md](./plan.md)

## 进行中

<!-- 开始某项任务时把它移到这里，并标注开始时间 -->

## 待办

_所有任务已完成，见下方。_

## 已完成

| # | 任务 | 完成日期 |
|---|------|----------|
| 1 | DB Migration: password_reset_tokens 表 | 2026-03-18 |
| 2 | Token 工具函数 + Validation Schemas | 2026-03-18 |
| 3 | 邮件服务 stub（console.log） | 2026-03-18 |
| 4 | API: POST /api/auth/forgot-password | 2026-03-18 |
| 5 | API: POST /api/auth/reset-password | 2026-03-18 |
| 6 | UI: /forgot-password 页面 + login页链接 | 2026-03-19 |
| 7 | UI: /reset-password 页面 | 2026-03-19 |

---

## 端到端验收清单

完成所有任务后，执行完整流程验证：

- [ ] 从 `/login` 点击"忘记密码？"跳转到 `/forgot-password`
- [ ] 提交已注册邮箱后显示成功提示，dev 终端打印重置链接
- [ ] 访问打印的重置链接，输入新密码后显示"密码已重置"
- [ ] 用新密码登录成功
- [ ] 用旧密码登录失败（"邮箱或密码错误"）
- [ ] 再次使用同一重置链接 → 显示"重置链接无效或已过期"（token 已消费）

---

## 备注

- **邮件发送**：开发环境使用 `console.log`，生产环境需接入真实服务（Resend / Nodemailer）。`src/lib/email.ts` 中有 TODO 注释。
- **Token 有效期**：1 小时，存储于 `password_reset_tokens.expires_at`。
- **安全设计**：忘记密码 API 对有效/无效邮箱返回相同响应，防止邮箱枚举攻击。Token 使用后立即删除（one-time use）。
