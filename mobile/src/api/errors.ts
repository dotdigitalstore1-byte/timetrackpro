export const OFFLINE_MESSAGE = 'No internet connection. Connect to the internet and try again.';
export const GENERIC_MESSAGE = 'Something went wrong. Please try again.';
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';

export class ApiError extends Error {
  readonly status?: number;
  readonly offline: boolean;
  readonly unauthorized: boolean;

  constructor(message: string, options: { status?: number; offline?: boolean; unauthorized?: boolean } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.offline = options.offline ?? false;
    this.unauthorized = options.unauthorized ?? false;
  }
}

/** Anything thrown while talking to the server becomes an ApiError with a message that is safe to show. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(GENERIC_MESSAGE);
}
