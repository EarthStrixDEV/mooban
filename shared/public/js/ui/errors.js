// Shared API-error reporting for UI modules.
import { ApiError } from '../api.js';
import { toast } from './toast.js';

export const GENERIC_ERROR = 'มีบางอย่างผิดพลาด ลองอีกครั้ง';

export function reportApiError(err) {
  if (err instanceof ApiError && err.status === 429) {
    toast(`ทำรายการเร็วเกินไป ลองใหม่ในอีก ${err.retryAfter ?? 1} วินาที`, { error: true });
  } else {
    toast(GENERIC_ERROR, { error: true });
  }
}
