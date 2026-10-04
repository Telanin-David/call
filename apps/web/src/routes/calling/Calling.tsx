import { Link } from 'react-router-dom';
import { Button, Icon, Note, Tile, buttonClass } from '@dialer/ui';
import { LEADS } from '@/lib/fake';
import { isLive } from '@/lib/backend';
import { PHONE, useMediaQuery } from '@/lib/useMediaQuery';
import { BlockedDialog, CallbackAlert } from './CallAlerts';
import CallingDesk from './CallingDesk';
import CallingPhone from './CallingPhone';
import { UpgradeDialog } from './Upgrade';
import { useCallSession, type CallSession } from './useCallSession';
import { useLiveCallSession } from './useLiveCallSession';

/**
 * The dial screen. One session (queue, call, results) drives two layouts:
 * a phone layout built for one hand, and the laptop layout with queue,
 * script and call panel side by side. Live, the session runs on the api;
 * in the demo, on fake data.
 */
export default function Calling() {
  return isLive() ? <LiveCalling /> : <DemoCalling />;
}

function DemoCalling() {
  return <CallScreen s={useCallSession()} />;
}

function LiveCalling() {
  return <CallScreen s={useLiveCallSession()} />;
}

function Empty({ title, body, action }: { title: string; body: string; action: { to: string; label: string } }) {
  return (
    <div className="mx-auto flex max-w-[440px] flex-col items-center gap-3 px-6 py-16 text-center">
      <Tile tone="brand"><Icon name="list" /></Tile>
      <b className="text-18">{title}</b>
      <p className="text-14 text-muted">{body}</p>
      <Link to={action.to} className={buttonClass({ variant: 'primary' })}>{action.label}</Link>
    </div>
  );
}

/** An error, or Undo for the result just saved, floating above the screen. */
function Bars({ s }: { s: CallSession }) {
  return (
    <>
      {s.error && (
        <div role="alert" className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-[520px] items-center gap-3 rounded-2xl bg-danger px-4 py-3 text-14 font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,.25)] lg:bottom-6">
          <span className="flex-1">{s.error}</span>
          <button type="button" aria-label="Close" onClick={s.clearError} className="flex size-7 cursor-pointer items-center justify-center rounded-full border-0 bg-white/15 text-white">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {s.undo && !s.error && (
        <div role="status" className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-[520px] items-center gap-3 rounded-full bg-night py-2 pl-4 pr-2 text-14 font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,.25)] lg:bottom-6">
          <Icon name="check" size={16} className="text-success" />
          <span className="min-w-0 flex-1 truncate">Saved: {s.undo.label}</span>
          <Button variant="glass" className="h-[34px]" onClick={s.undo.run}>Undo</Button>
        </div>
      )}
    </>
  );
}

function CallScreen({ s }: { s: CallSession }) {
  const phone = useMediaQuery(PHONE);

  if (s.loading) return <p className="px-6 py-12 text-center text-muted">Loading your leads…</p>;
  if (s.loadError) {
    return <Empty title="This list can't be opened" body={s.loadError} action={{ to: '/leads', label: 'Go to Leads' }} />;
  }
  const finished = !s.demo && s.phase === 'ready' && s.left === 0;
  if (!s.lead || !s.detail || finished) {
    return (
      <>
        {s.queue.length === 0 && !s.demo
          ? <Empty title="No one to call here" body="Everyone on this list has been called 3 times, is done, or is on the do-not-call list. Upload a list or pick another."
              action={{ to: '/leads', label: 'Pick a list' }} />
          : <Empty title="Your list is done" body="Pick another list on the Leads page." action={{ to: '/leads', label: 'Go to Leads' }} />}
        <Bars s={s} />
      </>
    );
  }

  return (
    <>
      {s.staleCall && (
        <Note tone="brand" className="m-4 text-14 sm:mx-6">
          <Icon name="call" size={16} className="text-brand-ink" />
          <span className="flex-1">A call from before is still open. End it before you start a new one.</span>
          <Button variant="outline" className="h-[34px]" onClick={s.staleCall.end}>End that call</Button>
        </Note>
      )}
      {phone ? <CallingPhone s={s} /> : <CallingDesk s={s} />}
      <Bars s={s} />
      <CallbackAlert open={s.sim === 'callback'} lead={LEADS.mark} sub="Reyes Home Care · you called him yesterday, 2:14 pm"
        note="Asked for prices by email first. Sent Monday." onAnswer={s.answerCallback} onLater={() => s.setSim(null)} />
      {s.block && <BlockedDialog copy={s.block} open={s.blockOpen} onPrimary={s.resolveBlock} onClose={() => { s.setBlockOpen(false); s.setSim(null); }} />}
      <UpgradeDialog open={s.upgrade !== null} to={s.upgrade?.to ?? 'starter'} reason={s.upgrade?.reason ?? ''} onClose={() => s.setUpgrade(null)} />
    </>
  );
}
