import { Fragment, useEffect, useRef } from 'react';
import { Avatar, Button, Pill } from '@dialer/ui';
import { DETAILS, RESULT_LABEL, type Lead } from '@/lib/fake';

export interface Peek { index: number; top: number; left: number }

/** Where to show the popover for a queue row: beside it if there's room, else under it. */
export function peekAt(index: number, row: HTMLElement): Peek {
  const r = row.getBoundingClientRect();
  const width = 300;
  const beside = r.right + 8 + width <= window.innerWidth;
  return beside
    ? { index, top: r.top, left: r.right + 8 }
    : { index, top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) };
}

/** Board 03: a look at who's next, opened from the queue during a call. */
export function NextLeadPopover({ peek, lead, onSkip, onCallNext, onClose }: {
  peek: Peek; lead: Lead; onSkip: () => void; onCallNext: () => void; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const d = DETAILS[lead.id];
  const pronoun = lead.pronoun === 'her' ? 'Her' : 'His';

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const rows: [string, string][] = [
    ['Phone', d?.phone ?? '—'],
    [`${pronoun} time`, d ? `${d.localTime}, ${d.location.split(',')[0] ?? ''}` : '—'],
    ['Calls so far', String(Math.max(0, (d?.attempt ?? 1) - 1))],
    ['Last time', d?.lastCall ? `${RESULT_LABEL[d.lastCall.result]}, ${d.lastCall.date}` : 'Not called yet'],
  ];

  return (
    <div ref={box} role="dialog" aria-label={`Next: ${lead.name}`} style={{ top: peek.top, left: peek.left }}
      className="fixed z-30 w-[300px] rounded-2xl border border-line bg-surface p-4 shadow-[0_16px_40px_rgba(0,0,0,.16)]">
      <div className="flex items-center gap-3">
        <Avatar initials={lead.initials} tone={lead.tone} size={38} />
        <div className="min-w-0 flex-1">
          <b className="block text-16">{lead.name}</b>
          <span className="text-13 text-muted">{d?.title ?? 'Lead'}, {lead.company}</span>
        </div>
        <Pill>Next</Pill>
      </div>
      <dl className="mt-3 grid grid-cols-[100px_minmax(0,1fr)] gap-y-1.5 text-14">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd>{v}</dd></Fragment>)}
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={onSkip}>Skip {lead.pronoun === 'her' ? 'her' : 'him'}</Button>
        <Button variant="outline" onClick={onCallNext}>Call next</Button>
      </div>
    </div>
  );
}
