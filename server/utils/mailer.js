import nodemailer from 'nodemailer';
import config from '../config.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const port = parseInt(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // SMTP_SECURE lets a domain provider that needs implicit TLS (typically
    // port 465) opt in explicitly; otherwise this defaults sensibly off
    // port number (465 = implicit TLS, everything else incl. 587 = STARTTLS).
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Bounded so a bad host/blocked port fails fast (a few seconds) instead
    // of hanging for the platform's default multi-minute socket timeout --
    // callers already treat send failures as non-fatal/background.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      // Some Windows setups (antivirus/network inspection) inject a self-signed
      // certificate into the TLS chain, which Node rejects by default.
      // Only relaxed outside production -- password-reset links and 2FA
      // codes go over this connection, so production must always verify
      // the real certificate. See AUDIT_REPORT.md.
      rejectUnauthorized: config.NODE_ENV === 'production',
    },
  });

  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[MAILER] SMTP not configured — skipping real email send. Would have sent:', { to, subject });
    return { skipped: true };
  }

  try {
    // SMTP_FROM_EMAIL/SMTP_FROM_NAME let the visible sender be a real domain
    // address (e.g. noreply@yourdomain.com) that differs from the SMTP auth
    // user -- required by providers like SendGrid/SES/Mailgun where the auth
    // user is an API key/account id, not the address mail should appear from.
    // Falls back to SMTP_USER so nothing breaks for setups that don't set them.
    const fromName = process.env.SMTP_FROM_NAME || 'Sniffr 🐾';
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
    const info = await getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(`[MAILER] Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[MAILER] Failed to send email:', err.message);
    return { success: false, error: err.message };
  }
}

export async function sendPawCodeEmail(toEmail, code) {
  return sendEmail({
    to: toEmail,
    subject: '🐾 Your Sniffr PawPrint Verification Code',
    text: `Your PawPrint verification code is: ${code}\n\nThis code expires in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #8E2E43;">🐾 PawPrint Verification</h2>
        <p>Your verification code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #8E2E43;">${code}</p>
        <p style="color: #666; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(toEmail, resetLink) {
  return sendEmail({
    to: toEmail,
    subject: '🐾 Reset Your Sniffr Password',
    text: `Reset your password using this link: ${resetLink}\n\nThis link expires in 1 hour.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #8E2E43;">🐾 Password Reset Request</h2>
        <p>Click the button below to reset your Sniffr password:</p>
        <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #8E2E43; color: white; text-decoration: none; border-radius: 24px; font-weight: bold;">Reset Password</a>
        <p style="color: #666; font-size: 14px; margin-top: 16px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export async function sendVerificationEmail(toEmail, verifyLink, options = {}) {
  const { isWelcome = false, fullName = '' } = options;
  const firstName = fullName ? fullName.split(' ')[0] : '';

  if (isWelcome) {
    return sendEmail({
      to: toEmail,
      subject: '🐾 Welcome to Sniffr! Let\'s get you verified',
      text: `Welcome to Sniffr${firstName ? `, ${firstName}` : ''}! We're so excited you're here. Before you start sniffing out our new app, please verify your email: ${verifyLink}\n\nThis link expires in 24 hours.`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #8E2E43;">🐾 Welcome to the pack${firstName ? `, ${firstName}` : ''}!</h2>
          <p>We're so happy you and your pet joined Sniffr — a home for pet parents to connect, share memories, and find new playmates nearby.</p>
          <p>Just one quick step before you dive in: please confirm this is your email address.</p>
          <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #8E2E43; color: white; text-decoration: none; border-radius: 24px; font-weight: bold; margin: 12px 0;">Verify My Email</a>
          <p style="color: #666; font-size: 14px; margin-top: 16px;">This link expires in 24 hours. If you didn't sign up for Sniffr, you can safely ignore this email.</p>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">🐾 See you on the other side — your pet's new friends are waiting!</p>
        </div>
      `,
    });
  }

  return sendEmail({
    to: toEmail,
    subject: '🐾 Verify your Sniffr email address',
    text: `Please verify your email by visiting this link: ${verifyLink}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #8E2E43;">🐾 Verify Your Email</h2>
        <p>Please confirm this is your email address by clicking the button below:</p>
        <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #8E2E43; color: white; text-decoration: none; border-radius: 24px; font-weight: bold;">Verify Email</a>
        <p style="color: #666; font-size: 14px; margin-top: 16px;">This link expires in 24 hours. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}