// Tests for utils/attachmentProcessor.js (full audit 1.63: SSRF via attachment urls).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ cloudName: 'mycloud', get: null }));
vi.mock('../../config/cloudinary.js', () => ({ default: { config: () => ({ cloud_name: state.cloudName }) } }));
vi.mock('axios', () => ({ default: { get: (...a) => state.get(...a) } }));

const { isAllowedAttachmentUrl, preprocessAttachmentsForGrok } = await import('../attachmentProcessor.js');

beforeEach(() => {
  state.cloudName = 'mycloud';
  state.get = vi.fn();
  for (const m of ['log', 'warn']) vi.spyOn(console, m).mockImplementation(() => {});
});

describe('isAllowedAttachmentUrl', () => {
  it.each([
    'https://res.cloudinary.com/mycloud/image/upload/v1/u1/abc.png',
    'https://res.cloudinary.com/mycloud/raw/upload/v1/u1/abc.pdf',
    'https://RES.cloudinary.com/mycloud/raw/upload/x.txt',
  ])('allows our own upload: %s', (u) => expect(isAllowedAttachmentUrl(u)).toBe(true));

  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['localhost service', 'http://localhost:6379/'],
    ['loopback https', 'https://127.0.0.1/admin'],
    ['internal hostname', 'https://internal.corp.local/secrets'],
    ['plain http cloudinary', 'http://res.cloudinary.com/mycloud/image/upload/a.png'],
    ['someone else\'s cloud', 'https://res.cloudinary.com/othercloud/image/upload/a.png'],
    ['host lookalike', 'https://res.cloudinary.com.evil.example/mycloud/a.png'],
    ['userinfo trick', 'https://res.cloudinary.com@evil.example/mycloud/a.png'],
    ['credentials on allowed host', 'https://user:pw@res.cloudinary.com/mycloud/a.png'],
    ['odd port', 'https://res.cloudinary.com:8443/mycloud/a.png'],
    ['file scheme', 'file:///etc/passwd'],
    ['data scheme', 'data:text/plain;base64,SGk='],
    ['garbage', 'not a url'],
    ['empty', ''],
  ])('rejects %s', (_n, u) => expect(isAllowedAttachmentUrl(u)).toBe(false));

  it('with no cloud name configured, still requires the Cloudinary host', () => {
    state.cloudName = undefined;
    expect(isAllowedAttachmentUrl('https://res.cloudinary.com/anything/x.png')).toBe(true);
    expect(isAllowedAttachmentUrl('http://169.254.169.254/')).toBe(false);
  });
});

describe('preprocessAttachmentsForGrok', () => {
  it('never fetches a disallowed url, and says so instead', async () => {
    const out = await preprocessAttachmentsForGrok([
      { name: 'meta.txt', type: 'text/plain', url: 'http://169.254.169.254/latest/meta-data/' },
      { name: 'pic.png', type: 'image/png', url: 'http://localhost:3001/api/secret' },
    ]);
    expect(state.get).not.toHaveBeenCalled();
    expect(out).toHaveLength(2);
    expect(out.every((a) => a.type === 'unknown' && /not an uploaded file/.test(a.content))).toBe(true);
  });

  it('still fetches and reads an allowed text attachment', async () => {
    state.get.mockResolvedValue({ data: '  hello from cloudinary  ' });
    const out = await preprocessAttachmentsForGrok([
      { name: 'a.txt', type: 'text/plain', url: 'https://res.cloudinary.com/mycloud/raw/upload/v1/u1/a.txt' },
    ]);
    expect(state.get).toHaveBeenCalledTimes(1);
    expect(out[0]).toMatchObject({ type: 'document', filename: 'a.txt', content: 'hello from cloudinary' });
  });

  it('keeps the existing no-url placeholder behavior', async () => {
    const out = await preprocessAttachmentsForGrok([{ name: 'x.txt', type: 'text/plain' }]);
    expect(state.get).not.toHaveBeenCalled();
    expect(out[0].content).toMatch(/no accessible URL/);
  });
});
