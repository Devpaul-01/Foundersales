// src/services/email.js
// ============================================================
// EMAIL SERVICE — Workspace Invite Emails (with comprehensive logging)
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

import { createLogger } from '../utils/logger.js';

const { log, logError, logWarn } = createLogger('EmailService');

const EMAIL_FROM     = process.env.EMAIL_FROM    || 'noreply@app.local';
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'console';
const FRONTEND_URL   = process.env.FRONTEND_URL  || 'http://localhost:5173';

// ── Send via Resend ──────────────────────────────────────────
const sendViaResend = async ({ to, subject, html, correlationId }) => {
  const startTime = Date.now();
  log('SEND_VIA_RESEND', { 
    to: maskEmail(to), 
    subject, 
    correlationId,
    provider: 'resend'
  });

  try {
    const { Resend } = await import('resend').catch(() => {
      throw new Error('resend package not installed. Run: npm install resend');
    });
    
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    const { data, error } = await resend.emails.send({ 
      from: EMAIL_FROM, 
      to, 
      subject, 
      html 
    });
    
    const duration = Date.now() - startTime;
    
    if (error) {
      logError('RESEND_SEND_ERROR', error, { 
        to: maskEmail(to), 
        subject, 
        correlationId, 
        duration 
      });
      throw new Error(`Resend error: ${error.message}`);
    }
    
    log('RESEND_SEND_SUCCESS', {
      to: maskEmail(to),
      subject,
      correlationId,
      duration,
      messageId: data?.id
    });
    
    return { success: true, messageId: data?.id, provider: 'resend', duration };
    
  } catch (err) {
    const duration = Date.now() - startTime;
    logError('RESEND_SEND_FAILED', err, {
      to: maskEmail(to),
      subject,
      correlationId,
      duration
    });
    throw err;
  }
};

// ── Send via SMTP (nodemailer) ───────────────────────────────
const sendViaSMTP = async ({ to, subject, html, correlationId }) => {
  const startTime = Date.now();
  log('SEND_VIA_SMTP', { 
    to: maskEmail(to), 
    subject, 
    correlationId,
    provider: 'smtp',
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT
  });

  try {
    const nodemailer = await import('nodemailer').catch(() => {
      throw new Error('nodemailer package not installed. Run: npm install nodemailer');
    });
    
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    
    // Verify SMTP connection before sending
    await transporter.verify();
    log('SMTP_CONNECTION_VERIFIED', { correlationId });
    
    const info = await transporter.sendMail({ 
      from: EMAIL_FROM, 
      to, 
      subject, 
      html 
    });
    
    const duration = Date.now() - startTime;
    
    log('SMTP_SEND_SUCCESS', {
      to: maskEmail(to),
      subject,
      correlationId,
      duration,
      messageId: info.messageId,
      response: info.response?.slice(0, 100)
    });
    
    return { success: true, messageId: info.messageId, provider: 'smtp', duration };
    
  } catch (err) {
    const duration = Date.now() - startTime;
    logError('SMTP_SEND_FAILED', err, {
      to: maskEmail(to),
      subject,
      correlationId,
      duration,
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT
    });
    throw err;
  }
};

// ── Console mode (development) ───────────────────────────────
const sendViaConsole = async ({ to, subject, html, correlationId }) => {
  log('CONSOLE_MODE_EMAIL', {
    to: maskEmail(to),
    subject,
    correlationId,
    htmlPreview: html?.slice(0, 200),
    inviteLink: extractInviteLink(html)
  });
  
  console.log(`\n📧 [Email] =========================================`);
  console.log(`📧 [Email] TO:      ${to}`);
  console.log(`📧 [Email] Subject: ${subject}`);
  console.log(`📧 [Email] Link:    ${extractInviteLink(html)}`);
  console.log(`📧 [Email] =========================================\n`);
  
  return { success: true, provider: 'console', mode: 'development' };
};

// ── Core send function ───────────────────────────────────────
export const sendEmail = async ({ to, subject, html, correlationId }) => {
  const startTime = Date.now();
  const cid = correlationId || generateCorrelationId();
  
  log('SEND_EMAIL_START', {
    to: maskEmail(to),
    subject,
    provider: EMAIL_PROVIDER,
    correlationId: cid,
    timestamp: new Date().toISOString()
  });

  try {
    if (!to) {
      throw new Error('Recipient email is required');
    }
    
    if (!subject) {
      throw new Error('Email subject is required');
    }
    
    if (!html) {
      throw new Error('Email HTML content is required');
    }
    
    let result;
    
    if (EMAIL_PROVIDER === 'resend') {
      result = await sendViaResend({ to, subject, html, correlationId: cid });
    } else if (EMAIL_PROVIDER === 'smtp') {
      result = await sendViaSMTP({ to, subject, html, correlationId: cid });
    } else {
      result = await sendViaConsole({ to, subject, html, correlationId: cid });
    }
    
    const totalDuration = Date.now() - startTime;
    
    log('SEND_EMAIL_SUCCESS', {
      to: maskEmail(to),
      subject,
      provider: EMAIL_PROVIDER,
      correlationId: cid,
      duration: totalDuration,
      result
    });
    
    return { success: true, correlationId: cid, ...result };
    
  } catch (err) {
    const totalDuration = Date.now() - startTime;
    logError('SEND_EMAIL_FAILED', err, {
      to: maskEmail(to),
      subject,
      provider: EMAIL_PROVIDER,
      correlationId: cid,
      duration: totalDuration
    });
    throw err;
  }
};

// ── Invite email template ────────────────────────────────────
export const sendWorkspaceInviteEmail = async ({
  inviteEmail,
  inviterName,
  workspaceName,
  token,
  correlationId = null,
}) => {
  const startTime = Date.now();
  const cid = correlationId || generateCorrelationId();
  const inviteLink = `${FRONTEND_URL}/accept-invite?token=${token}`;
  
  log('SEND_INVITE_START', {
    inviteEmail: maskEmail(inviteEmail),
    inviterName,
    workspaceName,
    correlationId: cid,
    tokenPreview: `${token?.slice(0, 8)}...`,
    frontendUrl: FRONTEND_URL
  });

  try {
    // Validate required fields
    if (!inviteEmail) {
      throw new Error('inviteEmail is required');
    }
    if (!workspaceName) {
      throw new Error('workspaceName is required');
    }
    if (!token) {
      throw new Error('token is required');
    }
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invitation to ${workspaceName}</title>
</head>
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
  <p style="color:#bbb;font-size:12px;word-break:break-all">
    Or copy this link: ${inviteLink}
  </p>
  <hr style="margin:32px 0 16px;border:none;border-top:1px solid #eee">
  <p style="color:#aaa;font-size:11px;margin:0">
    Invite ID: ${token.slice(0, 16)}...<br>
    Sent from: ${EMAIL_FROM}
  </p>
</body>
</html>`.trim();

    const result = await sendEmail({
      to: inviteEmail,
      subject: `You've been invited to ${workspaceName}`,
      html,
      correlationId: cid
    });
    
    const duration = Date.now() - startTime;
    
    log('SEND_INVITE_SUCCESS', {
      inviteEmail: maskEmail(inviteEmail),
      workspaceName,
      correlationId: cid,
      duration,
      provider: result.provider
    });
    
    return { 
      success: true, 
      correlationId: cid, 
      duration,
      inviteLink: EMAIL_PROVIDER === 'console' ? inviteLink : undefined
    };
    
  } catch (err) {
    const duration = Date.now() - startTime;
    logError('SEND_INVITE_FAILED', err, {
      inviteEmail: maskEmail(inviteEmail),
      workspaceName,
      correlationId: cid,
      duration,
      tokenPreview: `${token?.slice(0, 8)}...`
    });
    throw err;
  }
};

// ── Helper Functions ─────────────────────────────────────────
function maskEmail(email) {
  if (!email) return 'undefined';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

function extractInviteLink(html) {
  const match = html?.match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}

function generateCorrelationId() {
  return `email_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

// ── Health check for email configuration ─────────────────────
export const checkEmailConfig = () => {
  const config = {
    provider: EMAIL_PROVIDER,
    from: EMAIL_FROM,
    frontendUrl: FRONTEND_URL,
    isConfigured: false,
    details: {}
  };
  
  if (EMAIL_PROVIDER === 'resend') {
    config.isConfigured = !!process.env.RESEND_API_KEY;
    config.details = {
      hasApiKey: !!process.env.RESEND_API_KEY,
      apiKeyPreview: process.env.RESEND_API_KEY ? `${process.env.RESEND_API_KEY.slice(0, 8)}...` : null
    };
  } else if (EMAIL_PROVIDER === 'smtp') {
    config.isConfigured = !!(
      process.env.SMTP_HOST && 
      process.env.SMTP_USER && 
      process.env.SMTP_PASS
    );
    config.details = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      hasAuth: !!(process.env.SMTP_USER && process.env.SMTP_PASS)
    };
  } else {
    config.isConfigured = true; // Console mode always works
    config.details = { mode: 'development_only' };
  }
  
  log('EMAIL_CONFIG_CHECK', config);
  return config;
};
// ── Deal assigned email ──────────────────────────────────────
export const sendDealAssignedEmail = async ({
  assigneeEmail,
  assigneeName,
  assignerName,
  dealName,
  opportunityId,
  correlationId = null,
}) => {
  const cid = correlationId || generateCorrelationId();
  const dealUrl = `${FRONTEND_URL}/pipeline/${opportunityId}`;  // fix path if needed

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Deal assigned to you</title>
</head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 8px">A deal has been assigned to you</h2>
  <p style="color:#555;margin:0 0 4px">
    Hi ${assigneeName || 'there'},
  </p>
  <p style="color:#555;margin:0 0 24px">
    <strong>${assignerName || 'A manager'}</strong> has assigned you the following deal:
  </p>
  <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:0 0 24px">
    <p style="margin:0;font-size:16px;font-weight:600">${dealName}</p>
  </div>
  <a href="${dealUrl}"
     style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600">
    View Deal
  </a>
  <p style="margin:24px 0 0;color:#bbb;font-size:12px;word-break:break-all">
    Or copy this link: ${dealUrl}
  </p>
  <hr style="margin:32px 0 16px;border:none;border-top:1px solid #eee">
  <p style="color:#aaa;font-size:11px;margin:0">Sent from: ${EMAIL_FROM}</p>
</body>
</html>`.trim();

  return sendEmail({
    to: assigneeEmail,
    subject: `You've been assigned a deal: ${dealName}`,
    html,
    correlationId: cid,
  });
};
export default { sendEmail, sendWorkspaceInviteEmail, checkEmailConfig };