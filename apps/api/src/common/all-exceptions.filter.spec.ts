import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostFor(json: jest.Mock, status: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ id: 'req-123' }),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  const setup = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return { json, status, host: hostFor(json, status) };
  };

  it('preserves HTTP exceptions', () => {
    const { json, status, host } = setup();
    new AllExceptionsFilter().catch(new NotFoundException('Not here'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, message: 'Not here', requestId: 'req-123' }),
    );
  });

  it('hides raw database errors behind a generic 500', () => {
    const { json, status, host } = setup();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const filter = new AllExceptionsFilter();
    (filter as unknown as { logger: { error: jest.Mock } }).logger = { error: jest.fn() };
    filter.catch(
      new Error('duplicate key value violates unique constraint "users_tenant_id_email_key"'),
      host,
    );
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('constraint');
  });
});
