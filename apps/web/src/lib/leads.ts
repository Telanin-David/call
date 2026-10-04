import { useQuery } from '@tanstack/react-query';
import type { components } from '@dialer/api-client';
import { api } from './api';
import { isLive } from './backend';

type S = components['schemas'];
export type LeadList = S['LeadList'];
export type LeadField = S['LeadField'];
export type ImportCheck = S['ImportCheck'];
export type LeftOutRow = S['LeftOutRow'];
export type LeftOutReason = LeftOutRow['reason'];

export const leadKeys = {
  lists: ['lists'] as const,
};

export function useLists() {
  return useQuery({ queryKey: leadKeys.lists, queryFn: () => api.get<{ lists: LeadList[] }>('/lists'), enabled: isLive() });
}

/** The largest file the api takes. */
export const MAX_FILE_BYTES = 2 << 20;

/** Labels for the "Save as" picker, in the order it lists them. */
export const FIELD_LABEL: Record<LeadField, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Full name',
  company: 'Company',
  phone: 'Phone number',
  email: 'Email',
  city: 'City',
  notes: 'Notes',
  skip: 'Skip this column',
};
export const FIELDS = Object.keys(FIELD_LABEL) as LeadField[];

/**
 * Picks `field` for column `i`. A field is used once, so a column that had
 * it is skipped; a full name and first/last names don't go together.
 */
export function remap(mapping: readonly LeadField[], i: number, field: LeadField): LeadField[] {
  const clash = (f: LeadField) =>
    f === field ||
    (field === 'full_name' && (f === 'first_name' || f === 'last_name')) ||
    ((field === 'first_name' || field === 'last_name') && f === 'full_name');
  return mapping.map((f, j) => (j === i ? field : field !== 'skip' && clash(f) ? 'skip' : f));
}

/** "october-leads_2026.csv" → "October leads 2026". */
export function listNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'New list';
}

/**
 * Reads a CSV as text. Most files are UTF-8; older Excel saves Windows
 * Latin-1, which is read as such so "Zoë" stays "Zoë".
 */
export async function readCsvFile(file: Blob): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too big. Upload up to 2 MB or 5,000 rows at a time.');
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("That file couldn't be read. Try choosing it again."));
    reader.readAsArrayBuffer(file);
  });
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The end of a left-out row's line: why it was left out. */
export function leftOutWhy(r: LeftOutRow): string {
  switch (r.reason) {
    case 'abroad': return 'outside US and Canada';
    case 'duplicate': return r.same_as_row ? `duplicate of row ${r.same_as_row}` : 'duplicate';
    case 'dnc': return 'on the do-not-call list';
    case 'listed': return r.list_name ? `already in ${r.list_name}` : 'already in a list';
    case 'premium': return 'premium-rate number';
    case 'invalid': return r.phone ? 'not a full phone number' : 'no phone number';
  }
}

export function leftOutLine(r: LeftOutRow): string {
  return [`Row ${r.row}`, r.name, r.phone, leftOutWhy(r)].filter(Boolean).join(' · ');
}
