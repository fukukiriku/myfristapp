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
