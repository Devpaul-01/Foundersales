// src/services/email.js
// ============================================================
// EMAIL SERVICE — Workspace Invite Emails
//
// Uses environment variables for provider flexibility.
// Currently supports: Resend (recommended), SMTP via nodemailer.
//
// Set these env vars:
//   EMAIL_PROVIDER=resend       (or: smtp)
//   EMAIL_FROM=noreply@yourdomain.com
//
//   For Resend:
//     RESEND_API_KEY=re_...
//
//   For SMTP:
//     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//
// If EMAIL_PROVIDER is not set, emails are logged to console only
// (safe default for local dev / CI).
// ============================================================

const EMAIL_FROM    = process.env.EMAIL_FROM    || 'noreply@app.local';
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'console';
const FRONTEND_URL  = process.env.FRONTEND_URL  || 'http://localhost:5173';

// ── Send via Resend ──────────────────────────────────────────
const sendViaResend = async ({ to, subject, html }) => {
  const { Resend } = await import('resend').catch(() => {
    throw new Error('resend package not installed. Run: npm install resend');
  });
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
  if (error) throw new Error(`Resend error: ${error.message}`);
};

// ── Send via SMTP (nodemailer) ───────────────────────────────
const sendViaSMTP = async ({ to, subject, html }) => {
  const nodemailer = await import('nodemailer').catch(() => {
    throw new Error('nodemailer package not installed. Run: npm install nodemailer');
  });
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
};

// ── Core send function ───────────────────────────────────────
export const sendEmail = async ({ to, subject, html }) => {
  if (EMAIL_PROVIDER === 'resend') {
    return sendViaResend({ to, subject, html });
  }
  if (EMAIL_PROVIDER === 'smtp') {
    return sendViaSMTP({ to, subject, html });
  }
  // Console fallback — logs instead of sending (local dev)
  console.log(`[Email] CONSOLE MODE — Would send to: ${to}`);
  console.log(`[Email] Subject: ${subject}`);
  console.log(`[Email] HTML: ${html.slice(0, 200)}...`);
};

// ── Invite email template ────────────────────────────────────
export const sendWorkspaceInviteEmail = async ({
  inviteEmail,
  inviterName,
  workspaceName,
  token,
}) => {
  const inviteLink = `${FRONTEND_URL}/accept-invite?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 8px">You've been invited to join ${workspaceName}</h2>
  <p style="color:#555;margin:0 0 24px">
    ${inviterName || 'Someone'} has invited you to collaborate on <strong>${workspaceName}</strong>.
  </p>
  <a href="${inviteLink}"
     style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600">
    Accept Invitation
  </a>
  <p style="margin:24px 0 8px;color:#888;font-size:13px">
    This invite expires in 7 days. If you weren't expecting this, you can ignore this email.
  </p>
  <p style="color:#bbb;font-size:12px">Or copy this link: ${inviteLink}</p>
</body>
</html>`.trim();

  await sendEmail({
    to:      inviteEmail,
    subject: `You've been invited to ${workspaceName}`,
    html,
  });
};

export default { sendEmail, sendWorkspaceInviteEmail };
