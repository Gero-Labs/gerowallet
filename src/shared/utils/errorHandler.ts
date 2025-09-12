/**
 * Safe error message extraction utility
 * Avoids instanceof Error checks that can cause "Function has non-object prototype 'undefined'" errors
 * in certain browser environments or when Error constructor is modified
 */

export function getErrorMessage(error: unknown, fallback: string = 'Unknown error'): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return fallback;
}

export function getErrorDetails(error: unknown): { message: string; isError: boolean } {
  if (error && typeof error === 'object' && 'message' in error) {
    return {
      message: String(error.message),
      isError: true
    };
  }
  return {
    message: String(error) || 'Unknown error',
    isError: false
  };
}
