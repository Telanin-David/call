import { LEADS } from '@/lib/fake';
import { PHONE, useMediaQuery } from '@/lib/useMediaQuery';
import { BlockedDialog, CallbackAlert } from './CallAlerts';
import CallingDesk from './CallingDesk';
import CallingPhone from './CallingPhone';
import { UpgradeDialog } from './Upgrade';
import { useCallSession } from './useCallSession';

/**
 * The dial screen. One session (queue, call, results) drives two layouts:
 * a phone layout built for one hand, and the laptop layout with queue,
 * script and call panel side by side.
 */
export default function Calling() {
  const s = useCallSession();
  const phone = useMediaQuery(PHONE);

  if (!s.lead || !s.detail) {
    return <p className="px-6 py-12 text-center text-muted">Your list is done. Pick another list on the Leads page.</p>;
  }

  return (
    <>
      {phone ? <CallingPhone s={s} /> : <CallingDesk s={s} />}
      <CallbackAlert open={s.sim === 'callback'} lead={LEADS.mark} sub="Reyes Home Care · you called him yesterday, 2:14 pm"
        note="Asked for prices by email first. Sent Monday." onAnswer={s.answerCallback} onLater={() => s.setSim(null)} />
      {s.block && <BlockedDialog copy={s.block} open={s.blockOpen} onPrimary={s.resolveBlock} onClose={() => { s.setBlockOpen(false); s.setSim(null); }} />}
      <UpgradeDialog open={s.upgrade !== null} to={s.upgrade?.to ?? 'starter'} reason={s.upgrade?.reason ?? ''} onClose={() => s.setUpgrade(null)} />
    </>
  );
}
