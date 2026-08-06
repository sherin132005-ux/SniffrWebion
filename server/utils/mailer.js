import nodemailer from 'nodemailer';
import config from '../config.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // true for 465, false for other ports (587 uses STARTTLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
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
    const info = await getTransporter().sendMail({
      from: `"Sniffr 🐾" <${process.env.SMTP_USER}>`,
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