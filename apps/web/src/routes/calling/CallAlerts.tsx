import { useEffect, useState } from 'react';
import { Avatar, Button, Icon, Modal, Tile, Toggle, cn, type IconName, type TileTone } from '@dialer/ui';
import { fakeLeadsPickUp, setFakeLeadsPickUp } from '@/lib/phone';
import type { Lead } from '@/lib/fake';
import type { Block, Problem } from '@/lib/sim';

/** Board 29: a lead rings your number back while you're on the dial screen. */
export function CallbackAlert({ open, lead, sub, note, onAnswer, onLater }: {
  open: boolean; lead: Lead; sub: string; note: string; onAnswer: () => void; onLater: () => void;
}) {
  return (
    <Modal open={open} onClose={onLater} label={`${lead.name} is calling you back`} bare width="md"
      className="bg-night px-[22px] pb-[max(22px,env(safe-area-inset-bottom))] pt-[22px] text-white max-sm:flex max-sm:h-dvh max-sm:max-h-none max-sm:flex-col max-sm:justify-center max-sm:rounded-none">
      <div className="flex items-center gap-3.5 max-sm:flex-col max-sm:text-center">
        <span className="rounded-full p-[3px] shadow-[0_0_0_3px_var(--success)]">
          <Avatar initials={lead.initials} tone={lead.tone} size={52} />
        </span>
        <div className="min-w-0">
          <span className="text-12 font-extrabold uppercase tracking-[.08em] text-success">Calling you back</span>
          <b className="block text-24 font-extrabold tracking-[-0.02em]">{lead.name}</b>
          <span className="text-14 text-zinc-400">{sub}</span>
        </div>
      </div>
      <p className="mt-4 text-15 text-zinc-200"><b className="text-sun">Last note:</b> {note}</p>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <Button variant="glass" size="lg" onClick={onLater}>Not now, add to follow-ups</Button>
        <Button size="lg" className="bg-success font-bold text-white hover:bg-success" onClick={onAnswer}><Icon name="call" />Answer</Button>
      </div>
    </Modal>
  );
}

interface BlockCopy { icon: IconName; tone: TileTone; title: string; body: string; primary: string; secondary?: string }

export function blockCopy(block: Block, ctx: { limit: number | null; lead: string; next: string; balance: string }): BlockCopy {
  switch (block) {
    case 'limit':
      return {
        icon: 'clock', tone: 'brand',
        title: ctx.limit ? `You've used your ${ctx.limit} dials for today` : "You've reached today's dial limit",
        body: 'Calling opens again at midnight, your time. Verify your ID and Starter gives you 500 a day.',
        primary: 'Verify my ID', secondary: 'OK',
      };
    case 'balance':
      return {
        icon: 'wallet', tone: 'lemon', title: 'Top up to keep calling',
        body: `Your balance is ${ctx.balance}. That is not enough to start a call.`, primary: 'Add money', secondary: 'Not now',
      };
    case 'tries':
      return {
        icon: 'lock', tone: 'grey', title: `You can't call ${ctx.lead} again`,
        body: "You've called this number 3 times. We stop here so leads aren't pestered and your number stays clean.", primary: 'Skip to next lead',
      };
    case 'dnc':
      return {
        icon: 'ban', tone: 'red', title: `Skipped ${ctx.next}`,
        body: 'This number is on the do-not-call list. We never call it and you were not charged.', primary: 'Call next lead',
      };
  }
}

/** Board 34: shown before a call starts, never during one. */
export function BlockedDialog({ copy, open, onPrimary, onClose }: { copy: BlockCopy; open: boolean; onPrimary: () => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label={copy.title} width="sm">
      <Tile tone={copy.tone} size={40}><Icon name={copy.icon} size={20} /></Tile>
      <h2 className="mt-4 pr-8 text-22 font-extrabold tracking-[-0.02em]">{copy.title}</h2>
      <p className="mt-2 text-15 text-muted">{copy.body}</p>
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="primary" size="lg" block onClick={onPrimary}>{copy.primary}</Button>
        {copy.secondary && <Button size="lg" block onClick={onClose}>{copy.secondary}</Button>}
      </div>
    </Modal>
  );
}

const PROBLEM_BADGE: Record<Problem, { text: string; className: string }> = {
  internet: { text: 'Reconnecting', className: 'bg-sun/15 text-sun' },
  phone: { text: 'Phone lost', className: 'bg-tangerine/15 text-glow' },
  mic: { text: 'No mic', className: 'bg-danger/20 text-red-300' },
  weak: { text: 'Weak signal', className: 'bg-sun/15 text-sun' },
};

/**
 * Board 37: replaces the call card when the connection goes wrong. The lead
 * is never dropped without a warning, and there is always one next step.
 */
export function ProblemCard({ problem, timer, lead, canUsePhone, onFix, switchLabel = 'Use this laptop for sound', startLeft = 15 }: {
  problem: Problem; timer: string; lead: string; canUsePhone: boolean; onFix: (action: 'laptop' | 'phone' | 'retry' | 'ok') => void;
  /** The phone-lost button: live, the call can't move to the laptop, so it ends. */
  switchLabel?: string;
  /** Seconds left when the card appears: live, counted from the phone's last check-in. */
  startLeft?: number;
}) {
  const [left, setLeft] = useState(startLeft);
  useEffect(() => {
    setLeft(startLeft);
    if (problem !== 'internet' && problem !== 'phone') return;
    const t = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
    // startLeft only seeds the count when a problem starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem]);
  useEffect(() => {
    if (problem === 'internet' && left === 0) onFix('ok');
  }, [problem, left, onFix]);

  const badge = PROBLEM_BADGE[problem];
  return (
    <section role="alert" aria-label="Call problem" className="flex flex-col gap-3 rounded-3xl bg-night p-5 text-white">
      <span className={cn('inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-12 font-extrabold uppercase tracking-[.06em]', badge.className)}>
        <i className="size-1.5 rounded-full bg-current" />{badge.text}
      </span>
      <div className="text-52 font-semibold tracking-[-0.04em] tabular-nums text-zinc-400">{timer}</div>
      {problem === 'internet' && (
        <>
          <b className="text-20">Your internet dropped</b>
          <p className="text-14 text-zinc-400">The call is still open on our side. We keep trying for 15 seconds before it ends.</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Reconnecting" aria-valuenow={15 - left} aria-valuemax={15}>
            <span className="block h-full rounded-full bg-sun transition-[width] duration-1000" style={{ width: `${((15 - left) / 15) * 100}%` }} />
          </div>
        </>
      )}
      {problem === 'phone' && (
        <>
          <b className="text-20">{lead} is still on the line</b>
          <p className="text-14 text-zinc-400">Your phone stopped sending sound. We hold the call for 15 seconds: 0:{String(left).padStart(2, '0')} left.</p>
          <Button size="lg" block className="bg-white font-bold text-night hover:bg-white" onClick={() => onFix('laptop')}>{switchLabel}</Button>
          <Button variant="glass" size="lg" block onClick={() => onFix('phone')}>Link my phone again</Button>
        </>
      )}
      {problem === 'mic' && (
        <>
          <b className="text-20">Your browser blocked the mic</b>
          <p className="text-14 text-zinc-400">We need it to put you on calls.</p>
          <ol className="list-decimal pl-5 text-14 text-zinc-200">
            <li>Click the lock next to the web address</li>
            <li>Set Microphone to Allow</li>
            <li>Click Try again</li>
          </ol>
          <Button size="lg" block className="bg-white font-bold text-night hover:bg-white" onClick={() => onFix('retry')}>Try again</Button>
        </>
      )}
      {problem === 'weak' && (
        <>
          <b className="text-20">{lead} may hear you break up</b>
          <p className="text-14 text-zinc-400">Move closer to your Wi-Fi{canUsePhone ? ', or switch to your phone for sound' : ''}.</p>
          <Button size="lg" block className="bg-white font-bold text-night hover:bg-white" onClick={() => onFix(canUsePhone ? 'phone' : 'ok')}>
            {canUsePhone ? 'Switch to my phone' : 'OK'}
          </Button>
        </>
      )}
    </section>
  );
}

/** Development with the fake phone: whether fake leads pick up, to try unanswered calls. */
export function FakePickUpSwitch({ className }: { className?: string }) {
  const [on, setOn] = useState(fakeLeadsPickUp);
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-13', className)}>
      <span className="flex-1"><b className="block">Fake leads pick up</b><span className="text-muted">Development only. Off: the line rings, then drops.</span></span>
      <Toggle checked={on} onChange={v => { setOn(v); setFakeLeadsPickUp(v); }} label="Fake leads pick up" />
    </div>
  );
}
