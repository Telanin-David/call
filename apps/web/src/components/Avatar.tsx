import type { Lead } from '@/lib/fake';

export default function Avatar({ lead, size }: { lead: Lead; size: 32 | 36 | 38 }) {
  return <span className={`m-av dl-av-${lead.tone} dl-avsz-${size}`} aria-hidden="true">{lead.initials}</span>;
}
