import { AwsClient } from 'aws4fetch';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
}

export type SendEmailResult = { sent: true; messageId: string } | { sent: false; logged: true };

interface SesV2ErrorBody {
  ErrorCode?: string;
  message?: string;
}

interface ResendErrorBody {
  name?: string;
  message?: string;
}

type EmailEnv = Record<string, string | undefined>;

/** A SendEmailInput with `from` resolved and `to` normalized to an array. */
interface NormalizedEmail extends SendEmailInput {
  from: string;
  to: string[];
}

export async function sendEmail(
  platform: App.Platform,
  input: SendEmailInput
): Promise<SendEmailResult> {
  const env = platform.env as unknown as EmailEnv;
  const from = input.from ?? env.SES_FROM;
  const to = Array.isArray(input.to) ? input.to : [input.to];

  if (!from) {
    throw new Error('sendEmail: no From address (set SES_FROM or pass `from`)');
  }

  const normalized: NormalizedEmail = { ...input, from, to };
  const provider = (env.EMAIL_PROVIDER ?? 'ses').toLowerCase();

  return provider === 'resend' ? sendViaResend(env, normalized) : sendViaSes(env, normalized);
}

async function sendViaSes(env: EmailEnv, input: NormalizedEmail): Promise<SendEmailResult> {
  const accessKeyId = env.SES_ACCESS_KEY_ID;
  const secretAccessKey = env.SES_SECRET_ACCESS_KEY;
  const region = env.SES_REGION ?? 'us-west-1';

  // Local / test path: when the SES secret is missing, log the message and
  // skip the network call. Mirrors the R2 local-fallback pattern.
  if (!secretAccessKey || !accessKeyId) {
    console.log('[email:log-mode]', { from: input.from, to: input.to, subject: input.subject });
    return { sent: false, logged: true };
  }

  const body: Record<string, unknown> = {
    FromEmailAddress: input.from,
    Destination: { ToAddresses: input.to },
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: input.html, Charset: 'UTF-8' },
          ...(input.text ? { Text: { Data: input.text, Charset: 'UTF-8' } } : {})
        }
      }
    }
  };
  if (input.replyTo) body.ReplyToAddresses = [input.replyTo];

  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 'ses', region });
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const res = await client.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let errBody: SesV2ErrorBody = {};
    try {
      errBody = (await res.json()) as SesV2ErrorBody;
    } catch {
      // fall through to status-only error
    }
    const code = errBody.ErrorCode ?? `HTTP ${res.status}`;
    const msg = errBody.message ?? res.statusText;
    throw new Error(`SES SendEmail failed: ${code}: ${msg}`);
  }

  const data = (await res.json()) as { MessageId?: string };
  if (!data.MessageId) {
    throw new Error('SES SendEmail: response missing MessageId');
  }
  return { sent: true, messageId: data.MessageId };
}

async function sendViaResend(env: EmailEnv, input: NormalizedEmail): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY;

  // Local / test path: when the API key is missing, log the message and skip
  // the network call — same no-op contract as the SES path.
  if (!apiKey) {
    console.log('[email:log-mode]', { from: input.from, to: input.to, subject: input.subject });
    return { sent: false, logged: true };
  }

  const body: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html
  };
  if (input.text) body.text = input.text;
  if (input.replyTo) body.reply_to = input.replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let errBody: ResendErrorBody = {};
    try {
      errBody = (await res.json()) as ResendErrorBody;
    } catch {
      // fall through to status-only error
    }
    const code = errBody.name ?? `HTTP ${res.status}`;
    const msg = errBody.message ?? res.statusText;
    throw new Error(`Resend SendEmail failed: ${code}: ${msg}`);
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    throw new Error('Resend SendEmail: response missing id');
  }
  return { sent: true, messageId: data.id };
}
