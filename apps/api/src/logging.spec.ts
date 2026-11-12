import type { IncomingMessage, ServerResponse } from 'node:http';
import { REDACT_PATHS, requestIdFor } from './logging';

const res = () =>
  ({ setHeader: jest.fn() }) as unknown as ServerResponse & { setHeader: jest.Mock };

describe('requestIdFor', () => {
  it('reuses a safe inbound X-Request-Id and echoes it', () => {
    const r = res();
    const id = requestIdFor(
      { headers: { 'x-request-id': 'abc-123' } } as unknown as IncomingMessage,
      r,
    );
    expect(id).toBe('abc-123');
    expect(r.setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123');
  });

  it('replaces unsafe inbound ids with a UUID', () => {
    const id = requestIdFor(
      { headers: { 'x-request-id': '<script>' } } as unknown as IncomingMessage,
      res(),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('log redaction', () => {
  it('masks credentials and tokens', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.token',
      ]),
    );
  });
});
