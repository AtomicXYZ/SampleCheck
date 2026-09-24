export type ScrapeErrorCode =
  | 'INVALID_URL' | 'INVALID_ARGUMENT' | 'FETCH_FAILED' | 'REQUEST_TIMEOUT'
  | 'ACCESS_BLOCKED' | 'RATE_LIMITED' | 'HTTP_ERROR' | 'REDIRECT_REJECTED'
  | 'UNEXPECTED_CONTENT_TYPE' | 'PAGE_TOO_LARGE' | 'PAGE_STRUCTURE_CHANGED'
  | 'TRACK_NAME_NOT_FOUND' | 'ARTIST_NOT_FOUND' | 'RELATION_PARSE_FAILED'
  | 'TIMESTAMP_NOT_FOUND' | 'TIMESTAMP_PARSE_FAILED' | 'TIMESTAMP_CONFLICT'
  | 'BROWSER_UNAVAILABLE' | 'BROWSER_BUSY';

export class ScrapeError extends Error {
  constructor(
    public readonly code: ScrapeErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ScrapeError';
  }
}
