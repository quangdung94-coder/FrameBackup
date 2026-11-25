import { CANCELLED } from '../shared/constants';

export { CANCELLED };

export function cancelledError(): Error {
  return new Error(CANCELLED);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isCancelledMessage(message: string): boolean {
  return message === CANCELLED;
}
