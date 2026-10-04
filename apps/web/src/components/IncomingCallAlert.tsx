import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CallbackAlert } from '@dialer/ui';
import { usePlan } from '@/lib/plan';
import { useMe } from '@/lib/account';
import { errorText } from '@/lib/api';
import { activityKeys, initialsOf, toneOf } from '@/lib/activity';
import { answerIncoming } from '@/lib/phone';
import { callerLine, declineIncoming, incomingKey, useIncoming, useIncomingStore } from '@/lib/incoming';

/**
 * Board 29, live: a lead calling the rep's number back, on any screen, on
 * Starter and Pro. Answer takes the call to the call screen with the lead's
 * script; "Not now" ends it and puts the lead at the top of Follow-ups.
 */
export function IncomingCallAlert() {
  const { plan } = usePlan();
  const me = useMe();
  const q = useIncoming(Boolean(me.data) && plan !== 'free');
  const call = q.data?.call ?? null;
  const [closed, setClosed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const setRinging = useIncomingStore(s => s.setRinging);
  const lead = call?.lead ?? null;
  const open = call !== null && lead !== null && call.id !== closed;

  useEffect(() => { setRinging(open); }, [open, setRinging]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => () => setRinging(false), [setRinging]);

  if (!call || !lead) return error ? <AlertError text={error} /> : null;

  const refresh = () => Promise.all([incomingKey, ['followups'], activityKeys.today, ['history']].map(queryKey => qc.invalidateQueries({ queryKey })));

  async function answer() {
    if (!call || !lead) return;
    setClosed(call.id);
    setError(null);
    try {
      const phone = await answerIncoming(call);
      useIncomingStore.getState().take(call, phone);
      if (!pathname.startsWith('/call')) navigate(`/call/${lead.id}`);
    } catch (e) {
      setError(errorText(e));
    }
    void refresh();
  }

  function later() {
    if (!call) return;
    setClosed(call.id);
    void declineIncoming(call.id).catch(() => { /* it stops ringing on its own */ }).then(refresh);
  }

  return (
    <>
      <CallbackAlert open={open} lead={{ name: lead.name, initials: initialsOf(lead.name), tone: toneOf(lead.id) }}
        sub={callerLine(call)} note={lead.last_call?.note ?? ''} onAnswer={() => void answer()} onLater={later} />
      {error && <AlertError text={error} />}
    </>
  );
}

function AlertError({ text }: { text: string }) {
  return (
    <div role="alert" className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-[520px] rounded-2xl bg-danger px-4 py-3 text-14 font-semibold text-white lg:bottom-6">
      {text}
    </div>
  );
}
