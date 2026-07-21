import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getSmtpConfig } from "./config";

let cached: Transporter | null = null;

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: {
    filename: string;
    content: Buffer;
    cid: string;
    contentType?: string;
  }[];
}

function getTransport(): Transporter | null {
  const cfg = getSmtpConfig();
  if (!cfg) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
    });
  }
  return cached;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const cfg = getSmtpConfig();
  const transport = getTransport();
  if (!cfg || !transport) {
    throw new Error("Email is not configured (SMTP_HOST unset).");
  }
  await transport.sendMail({
    from: cfg.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
  });
}
