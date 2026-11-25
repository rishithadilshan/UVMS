// Email delivery. Uses nodemailer when it is installed AND SMTP_HOST is configured; otherwise the message
// is only written to email_log (and the console in development). In-app notifications never depend on email.
const pool = require('../db/pool');
let transporter = null;
let tried = false;

function getTransporter() {
  if (tried) return transporter;
  tried = true;
  if (!process.env.SMTP_HOST) return null;
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  } catch { console.warn('[mailer] SMTP_HOST is set but the "nodemailer" package is not installed; emails are only logged'); }
  return transporter;
}

async function send(to, subject, body) {
  let status = 'LOGGED', error = null;
  const t = getTransporter();
  if (t) {
    try { await t.sendMail({ from: process.env.MAIL_FROM || 'UVMS <no-reply@localhost>', to, subject, text: body }); status = 'SENT'; }
    catch (e) { status = 'FAILED'; error = e.message; console.error('[mailer] send failed:', e.message); }
  } else if (process.env.NODE_ENV !== 'production') console.log(`[mailer] (not sent, no SMTP) to=${to} subject="${subject}"`);
  await pool.query('INSERT INTO email_log(to_address,subject,body,status,error) VALUES($1,$2,$3,$4,$5)', [to, subject, body, status, error]).catch(() => {});
  return status;
}
module.exports = { send };
