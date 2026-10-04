import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Button, Card, DarkCard, Icon, Modal, Pill, cn, linkClass, useToast } from '@dialer/ui';
import { Page } from '@/components/Page';
import { usePlan } from '@/lib/plan';
import { CALLS, RESULT_LABEL, RESULT_TONE, type CallRecord } from '@/lib/fake';
import { formatUsd } from '@/lib/money';

interface Line { you: boolean; text: string }

const TRANSCRIPTS: Record<string, { lines: Line[]; summary: string[]; followup?: string }> = {
  ada: {
    lines: [
      { you: true, text: "Hi Ada, this is Tunde from Bright Clean. I know I'm calling out of the blue. Do you have 30 seconds?" },
      { you: false, text: 'Sure, go ahead. Quickly though.' },
      { you: true, text: 'We clean offices across New York. How is cleaning going across your sites right now?' },
      { you: false, text: 'Honestly not great. Our current company skips Fridays and we have two sites in Queens.' },
      { you: true, text: "That's the main reason people switch to us. Could we book 15 minutes to walk through a quote?" },
      { you: false, text: 'Thursday works. After 10 am, my time.' },
    ],
    summary: ['Unhappy with current cleaner. They skip Fridays.', 'Two sites in Queens.', 'Open to a quote. Wants a call Thursday after 10 am her time.'],
    followup: 'Thu 3 Oct, 10:30 am their time',
  },
  lena: {
    lines: [
      { you: true, text: "Hi Lena, it's Tunde from Bright Clean again. Is now still a good time?" },
      { you: false, text: "Not really, I'm between meetings. Can you try me after 3?" },
      { you: true, text: "Of course. I'll call you after 3 pm your time." },
    ],
    summary: ['Busy, asked for a call after 3 pm her time.', 'Still unhappy with the Friday cleaner.'],
    followup: 'Today, 3:30 pm their time',
  },
  rosa: {
    lines: [
      { you: true, text: 'Hi Rosa, this is Tunde from Bright Clean. Do you have 30 seconds?' },
      { you: false, text: "We do our own cleaning, we're a cleaning company. Thanks though." },
    ],
    summary: ['Runs a cleaning company herself. Not a fit.'],
  },
};

const SPEEDS = [1, 1.5, 2] as const;
const BARS = Array.from({ length: 64 }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)) * 26));

function seconds(length: string): number {
  const [m, s] = length.split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

function clock(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function Player({ call }: { call: CallRecord }) {
  const total = seconds(call.length);
  const [at, setAt] = useState(Math.min(158, total));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setAt(a => Math.min(total, a + speed)), 1000);
    return () => clearInterval(t);
  }, [playing, speed, total]);

  useEffect(() => {
    if (at >= total) setPlaying(false);
  }, [at, total]);

  const played = Math.round((at / total) * BARS.length);
  return (
    <div className="mt-4 flex items-center gap-3">
      <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { if (at >= total) setAt(0); setPlaying(p => !p); }}
        className="flex size-11 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-night text-white">
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <div className="flex h-9 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(at)}
        tabIndex={0} onKeyDown={e => { if (e.key === 'ArrowRight') setAt(a => Math.min(total, a + 5)); if (e.key === 'ArrowLeft') setAt(a => Math.max(0, a - 5)); }}>
        {BARS.map((h, i) => (
          <span key={i} style={{ height: h }} className={cn('w-[3px] flex-none rounded-full', i < played ? 'bg-tangerine' : 'bg-off')} />
        ))}
      </div>
      <span className="text-13 tabular-nums text-muted max-sm:hidden">{clock(at)} / {call.length}</span>
      <Button variant="outline" className="h-9 px-3" onClick={() => setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length] ?? 1)}>{speed}x</Button>
    </div>
  );
}

export default function Recording() {
  const { plan } = usePlan();
  const navigate = useNavigate();
  const { callId } = useParams();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const today = CALLS.filter(c => c.when.startsWith('Today'));
  const call = today.find(c => c.lead.id === callId) ?? today.find(c => c.lead.id === 'ada') ?? today[0];
  if (!call) return null;
  const data = TRANSCRIPTS[call.lead.id];
  const first = call.lead.name.split(' ')[0] ?? call.lead.name;

  if (plan !== 'pro') {
    return (
      <Page width={1040}>
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink"><Icon name="lock" /></span>
          <h1 className="text-24 font-extrabold tracking-[-0.03em]">Recordings come with Pro</h1>
          <p className="max-w-[440px] text-15 text-muted">Every call recorded, with a transcript and a short summary you can turn into a follow-up.</p>
          <Link to="/plans" className={cn(linkClass, 'text-15')}>See Pro</Link>
        </Card>
      </Page>
    );
  }

  return (
    <Page width={1240}>
      <div className="grid items-start gap-3.5 lg:grid-cols-[260px_minmax(0,1fr)_340px] lg:gap-5">
        <nav aria-label="Today's calls" className="flex flex-col gap-1 max-lg:order-3">
          <span className="px-3 pb-2 text-12 font-extrabold uppercase tracking-[.06em] text-faint">Today</span>
          {today.map(c => {
            const current = c === call;
            return (
              <Link key={c.lead.id} to={`/history/${c.lead.id}`} aria-current={current ? 'page' : undefined}
                className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-ink no-underline hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:shadow-[0_1px_3px_rgba(0,0,0,.06)]">
                <Avatar initials={c.lead.initials} tone={c.lead.tone} size={32} />
                <span className="min-w-0 flex-1"><b className="block text-15">{c.lead.name}</b><span className="text-13 text-muted">{RESULT_LABEL[c.result]} · {c.length}</span></span>
                <Icon name="play" size={15} className="text-faint" />
              </Link>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-col gap-3.5 max-lg:order-1">
          <Card as="section" aria-label="Recording">
            <div className="flex flex-wrap items-center gap-3.5">
              <Avatar initials={call.lead.initials} tone={call.lead.tone} size={52} />
              <div className="min-w-0 flex-1">
                <h1 className="text-24 font-extrabold tracking-[-0.03em]">{call.lead.name}</h1>
                <p className="text-14 text-muted">{call.lead.company} · {call.when.toLowerCase()} · {call.length} · {formatUsd(call.cost)}</p>
              </div>
              <Pill tone={RESULT_TONE[call.result]}>{RESULT_LABEL[call.result]}</Pill>
            </div>
            <Player key={call.lead.id} call={call} />
          </Card>

          <Card as="section" aria-label="Transcript">
            <span className="text-12 font-extrabold uppercase tracking-[.06em] text-faint">Transcript</span>
            {data ? (
              <ol className="mt-4 flex list-none flex-col gap-2.5">
                {data.lines.map((l, i) => (
                  <li key={i} className={cn('flex items-start gap-3', l.you && 'flex-row-reverse')}>
                    <span className="w-10 flex-none pt-3 text-11 font-bold uppercase text-faint max-sm:hidden">{l.you ? 'You' : first}</span>
                    <p className={cn('max-w-[440px] rounded-2xl px-3.5 py-2.5 text-15', l.you ? 'bg-brand-soft' : 'bg-sunk')}>
                      <span className="sr-only">{l.you ? 'You' : first}: </span>{l.text}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-15 text-muted">No one picked up, so there's nothing to transcribe.</p>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-3.5 max-lg:order-2">
          {data && (
            <DarkCard blobs="number" as="section" aria-label="Summary" className="p-[22px]">
              <span className="flex items-center gap-2 text-12 font-extrabold uppercase tracking-[.06em] text-sun"><Icon name="spark" size={15} />Summary</span>
              <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-15 text-zinc-200">
                {data.summary.map(s => <li key={s}>{s}</li>)}
              </ul>
              {data.followup && (
                <div className="mt-5 rounded-2xl bg-white/8 p-3.5">
                  <span className="text-13 text-zinc-400">Suggested follow-up</span>
                  <b className="mb-3 block text-17">{data.followup}</b>
                  <Button variant="primary" block onClick={() => navigate('/followups')}>Add to follow-ups</Button>
                </div>
              )}
            </DarkCard>
          )}
          <Card className="flex flex-col gap-2.5 p-[18px]">
            <Button variant="outline" block onClick={() => toast('Downloads come with real recordings in D5')}>Download recording</Button>
            <Button variant="outlineDanger" block onClick={() => setConfirmDelete(true)}>Delete recording</Button>
            <p className="text-13 text-muted">Recordings are kept for 90 days.</p>
          </Card>
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this recording?" width="sm">
        <p className="mt-2 text-15 text-muted">The recording and transcript of your call with {call.lead.name} are removed for good. The call stays in your history.</p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <Button size="lg" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          <Button variant="danger" size="lg" onClick={() => { setConfirmDelete(false); toast('Recording deleted'); navigate('/history'); }}>Delete</Button>
        </div>
      </Modal>
    </Page>
  );
}
