import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockConsole } from '$lib/server/test/mock-console';
import { sendEmail } from './send';

function platform(env: Record<string, string | undefined>): App.Platform {
  return { env } as unknown as App.Platform;
}

describe('sendEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: 'SES_SECRET_ACCESS_KEY missing',
      env: {
        SES_ACCESS_KEY_ID: 'AKIA',
        SES_REGION: 'us-west-1',
        SES_FROM: 'no-reply@sfhousing.mindlace.net'
      }
    },
    {
      name: 'access key id missing',
      env: { SES_SECRET_ACCESS_KEY: 'sk', SES_FROM: 'no-reply@sfhousing.mindlace.net' }
    }
  ])('logs and skips network when $name', async ({ env }) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { log: logSpy } = mockConsole('log');

    const r = await sendEmail(platform(env), { to: 'a@b.com', subject: 'hi', html: '<p>hi</p>' });

    expect(r).toEqual({ sent: false, logged: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[email:log-mode]',
      expect.objectContaining({ to: ['a@b.com'], subject: 'hi' })
    );
  });

  it('throws when no From is configured anywhere', async () => {
    await expect(
      sendEmail(platform({}), { to: 'a@b.com', subject: 's', html: '<p>x</p>' })
    ).rejects.toThrow(/From/);
  });

  it('signs and POSTs to SES v2 with the expected body shape', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ MessageId: 'msg-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const r = await sendEmail(
      platform({
        SES_ACCESS_KEY_ID: 'AKIAEXAMPLE',
        SES_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG',
        SES_REGION: 'us-west-1',
        SES_FROM: 'no-reply@sfhousing.mindlace.net'
      }),
      {
        to: 'recipient@example.com',
        subject: 'You are invited',
        html: '<p>Join</p>',
        text: 'Join',
        replyTo: 'support@sfhousing.mindlace.net'
      }
    );

    expect(r).toEqual({ sent: true, messageId: 'msg-123' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const req = fetchSpy.mock.calls[0][0] as Request;
    expect(req.url).toBe('https://email.us-west-1.amazonaws.com/v2/email/outbound-emails');
    expect(req.method).toBe('POST');
    expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256/);
    expect(req.headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
    expect(req.headers.get('content-type')).toBe('application/json');

    const body = JSON.parse(await req.text());
    expect(body).toEqual({
      FromEmailAddress: 'no-reply@sfhousing.mindlace.net',
      Destination: { ToAddresses: ['recipient@example.com'] },
      Content: {
        Simple: {
          Subject: { Data: 'You are invited', Charset: 'UTF-8' },
          Body: {
            Html: { Data: '<p>Join</p>', Charset: 'UTF-8' },
            Text: { Data: 'Join', Charset: 'UTF-8' }
          }
        }
      },
      ReplyToAddresses: ['support@sfhousing.mindlace.net']
    });
  });

  it('omits Text body when no text alternative is provided', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ MessageId: 'm' }), { status: 200 }));
    await sendEmail(
      platform({
        SES_ACCESS_KEY_ID: 'AKIA',
        SES_SECRET_ACCESS_KEY: 'sk',
        SES_REGION: 'us-west-1',
        SES_FROM: 'no-reply@sfhousing.mindlace.net'
      }),
      { to: ['a@b.com', 'c@d.com'], subject: 's', html: '<p>h</p>' }
    );
    const req = fetchSpy.mock.calls[0][0] as Request;
    const body = JSON.parse(await req.text());
    expect(body.Destination.ToAddresses).toEqual(['a@b.com', 'c@d.com']);
    expect(body.Content.Simple.Body.Text).toBeUndefined();
    expect(body.ReplyToAddresses).toBeUndefined();
  });

  it('surfaces SES error responses with ErrorCode and message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ErrorCode: 'MessageRejected', message: 'Email address not verified' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await expect(
      sendEmail(
        platform({
          SES_ACCESS_KEY_ID: 'AKIA',
          SES_SECRET_ACCESS_KEY: 'sk',
          SES_REGION: 'us-west-1',
          SES_FROM: 'no-reply@sfhousing.mindlace.net'
        }),
        { to: 'a@b.com', subject: 's', html: '<p>h</p>' }
      )
    ).rejects.toThrow(/MessageRejected.*Email address not verified/);
  });

  it('throws when SES response lacks MessageId', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    await expect(
      sendEmail(
        platform({
          SES_ACCESS_KEY_ID: 'AKIA',
          SES_SECRET_ACCESS_KEY: 'sk',
          SES_REGION: 'us-west-1',
          SES_FROM: 'no-reply@sfhousing.mindlace.net'
        }),
        { to: 'a@b.com', subject: 's', html: '<p>h</p>' }
      )
    ).rejects.toThrow(/MessageId/);
  });

  it('allows per-call from override', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ MessageId: 'm' }), { status: 200 }));
    await sendEmail(
      platform({
        SES_ACCESS_KEY_ID: 'AKIA',
        SES_SECRET_ACCESS_KEY: 'sk',
        SES_REGION: 'us-west-1',
        SES_FROM: 'default@sfhousing.mindlace.net'
      }),
      { to: 'a@b.com', subject: 's', html: '<p>h</p>', from: 'other@sfhousing.mindlace.net' }
    );
    const body = JSON.parse(await (fetchSpy.mock.calls[0][0] as Request).text());
    expect(body.FromEmailAddress).toBe('other@sfhousing.mindlace.net');
  });
});

describe('sendEmail via Resend (EMAIL_PROVIDER=resend)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function resendEnv(extra: Record<string, string | undefined> = {}) {
    return {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test_key',
      SES_FROM: 'no-reply@sfhousing.mindlace.net',
      ...extra
    };
  }

  it('logs and skips network when RESEND_API_KEY is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { log: logSpy } = mockConsole('log');

    const r = await sendEmail(platform(resendEnv({ RESEND_API_KEY: undefined })), {
      to: 'a@b.com',
      subject: 'hi',
      html: '<p>hi</p>'
    });

    expect(r).toEqual({ sent: false, logged: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[email:log-mode]',
      expect.objectContaining({ to: ['a@b.com'], subject: 'hi' })
    );
  });

  it('POSTs to the Resend API with a Bearer token and the expected body shape', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const r = await sendEmail(platform(resendEnv()), {
      to: 'recipient@example.com',
      subject: 'You are invited',
      html: '<p>Join</p>',
      text: 'Join',
      replyTo: 'support@sfhousing.mindlace.net'
    });

    expect(r).toEqual({ sent: true, messageId: 'resend-123' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: 'no-reply@sfhousing.mindlace.net',
      to: ['recipient@example.com'],
      subject: 'You are invited',
      html: '<p>Join</p>',
      text: 'Join',
      reply_to: 'support@sfhousing.mindlace.net'
    });
  });

  it('omits text and reply_to when not provided; passes multiple recipients', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'm' }), { status: 200 }));
    await sendEmail(platform(resendEnv()), {
      to: ['a@b.com', 'c@d.com'],
      subject: 's',
      html: '<p>h</p>'
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(['a@b.com', 'c@d.com']);
    expect(body.text).toBeUndefined();
    expect(body.reply_to).toBeUndefined();
  });

  it('surfaces Resend error responses with name and message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ name: 'validation_error', message: 'The from field is invalid' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await expect(
      sendEmail(platform(resendEnv()), { to: 'a@b.com', subject: 's', html: '<p>h</p>' })
    ).rejects.toThrow(/validation_error.*from field is invalid/);
  });

  it('throws when the Resend response lacks an id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    await expect(
      sendEmail(platform(resendEnv()), { to: 'a@b.com', subject: 's', html: '<p>h</p>' })
    ).rejects.toThrow(/id/);
  });

  it('allows per-call from override', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'm' }), { status: 200 }));
    await sendEmail(platform(resendEnv({ SES_FROM: 'default@sfhousing.mindlace.net' })), {
      to: 'a@b.com',
      subject: 's',
      html: '<p>h</p>',
      from: 'other@sfhousing.mindlace.net'
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('other@sfhousing.mindlace.net');
  });
});
