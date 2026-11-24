import { ApiError, GENERIC_MESSAGE, OFFLINE_MESSAGE, toApiError } from '../src/api/errors';

describe('error messages', () => {
  it('keeps the server message and its flags', () => {
    const err = new ApiError('Invalid email ID / username or password.', { status: 401 });
    expect(toApiError(err)).toBe(err);
    expect(err.offline).toBe(false);
    expect(err.unauthorized).toBe(false);
  });

  it('turns anything unknown into the generic message, never the raw error text', () => {
    const err = toApiError(new TypeError('Network request failed'));
    expect(err.message).toBe(GENERIC_MESSAGE);
    expect(err.message.toLowerCase()).not.toContain('network');
  });

  it('has a clear offline message', () => {
    expect(new ApiError(OFFLINE_MESSAGE, { offline: true }).offline).toBe(true);
  });
});
