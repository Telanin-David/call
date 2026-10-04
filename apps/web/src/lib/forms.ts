import { ApiError } from './api';

/** Which form field an api error belongs under, by its code. */
const FIELD: Record<string, string> = {
  invalid_name: 'name',
  invalid_email: 'email',
  email_taken: 'email',
  invalid_phone: 'phone',
  phone_taken: 'phone',
  invalid_password: 'password',
  invalid_country: 'phone',
  rules_required: 'rules',
  code_wrong: 'code',
  code_expired: 'code',
  code_locked: 'code',
};

export interface FormProblem {
  field?: string;
  message: string;
}

/** Turns a failed request into a message, placed under a field when one fits. */
export function problemOf(err: unknown): FormProblem | null {
  if (!err) return null;
  if (err instanceof ApiError) return { field: FIELD[err.code], message: err.message };
  return { message: 'Something went wrong. Try again.' };
}

/** The message for one field, or undefined. */
export function fieldError(p: FormProblem | null, field: string): string | undefined {
  return p?.field === field ? p.message : undefined;
}

/** A form-level message, for problems that belong to no single field. */
export function formError(p: FormProblem | null): string | undefined {
  return p && !p.field ? p.message : undefined;
}

export function text(data: FormData, key: string): string {
  const v = data.get(key);
  return typeof v === 'string' ? v : '';
}

/** Countries a rep can sign up from, with their calling codes. */
export const COUNTRIES = [
  { code: 'NG', dial: '234', name: 'Nigeria' },
  { code: 'GH', dial: '233', name: 'Ghana' },
  { code: 'KE', dial: '254', name: 'Kenya' },
  { code: 'ZA', dial: '27', name: 'South Africa' },
  { code: 'US', dial: '1', name: 'United States' },
  { code: 'CA', dial: '1', name: 'Canada' },
  { code: 'GB', dial: '44', name: 'United Kingdom' },
] as const;

/** "0803 123 4567" in Nigeria → "+2348031234567". A number typed with + is kept. */
export function fullPhone(national: string, dial: string): string {
  const t = national.trim();
  if (t.startsWith('+')) return t;
  return `+${dial}${t.replace(/\D/g, '').replace(/^0+/, '')}`;
}

/** The browser's time zone, e.g. "Africa/Lagos". */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
