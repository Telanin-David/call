import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button, CodeBoxes, CodeInput, Icon, Tile, cn, linkClass, useToast } from '@dialer/ui';
import AuthShell, { AuthForm, AuthTitle } from '@/layouts/AuthShell';
import { api, ApiError, errorText } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { homeFor, useMe, type Me } from '@/lib/account';
import { useCooldown } from '@/lib/cooldown';
import { fieldError, problemOf } from '@/lib/forms';

/** "+2348031234567" → "+234 803 123 4567", for showing where the code went. */
function spaced(phone: string): string {
  const m = /^\+(234|233|254|27|44|1)(\d{3})(\d{3})(\d+)$/.exec(phone);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

export default function Confirm() {
  const navigate = useNavigate();
  const toast = useToast();
  const live = isLive();
  const me = useMe();
  const [code, setCode] = useState('');
  const wait = useCooldown(live ? 60 : 42); // a code was just sent at sign up

  const confirm = useMutation({
    mutationFn: () => api.post<Me>('/auth/confirm/phone', { code }),
    onSuccess: async () => {
      const r = await me.refetch();
      navigate(r.data ? (homeFor(r.data) === '/' ? '/setup' : homeFor(r.data)) : '/setup');
    },
  });
  const resend = useMutation({
    mutationFn: (channel: 'sms' | 'whatsapp') => api.post<void>('/auth/resend', { channel }),
    onSuccess: (_, channel) => {
      wait.start(60);
      setCode('');
      toast(channel === 'whatsapp' ? `Code sent by WhatsApp to ${phone}` : `New code sent to ${phone}`);
    },
    onError: err => {
      if (err instanceof ApiError && err.retryAfter) wait.start(err.retryAfter);
      toast(errorText(err));
    },
  });

  if (live && me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/signin" replace />;
  const phone = live ? spaced(me.data?.phone ?? '') : '+234 803 123 4567';
  const email = live ? me.data?.email ?? '' : 'tunde.bakare@gmail.com';
  const emailDone = !live || Boolean(me.data?.email_confirmed);
  const codeError = fieldError(problemOf(confirm.error), 'code') ?? (confirm.error ? errorText(confirm.error) : undefined);

  function sendBy(channel: 'sms' | 'whatsapp') {
    if (live) resend.mutate(channel);
    else toast(`Code sent by WhatsApp to ${phone}`);
  }

  return (
    <AuthShell signupStep={{ n: 2, label: 'Confirm' }}>
      <AuthForm wide onSubmit={() => (live ? confirm.mutate() : navigate('/setup'))}>
        <AuthTitle title="Confirm it's you" sub="Two quick checks so leads only ever hear real people." />
        <div className={cn('flex items-center gap-3.5 rounded-2xl px-[18px] py-4', emailDone ? 'bg-success-soft' : 'bg-warn-soft')}>
          <span className={cn('flex size-[38px] flex-none items-center justify-center rounded-full text-white', emailDone ? 'bg-success' : 'bg-warn')}>
            <Icon name={emailDone ? 'check' : 'mail'} />
          </span>
          <div className="flex-1">
            <b className="text-15">{emailDone ? 'Email confirmed' : 'Email not confirmed yet'}</b>
            <p className={cn('text-13', emailDone ? 'text-success-ink' : 'text-warn-ink')}>{emailDone ? email : `Open the link we sent to ${email}`}</p>
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-[22px]">
          <div className="flex items-center gap-3.5">
            <Tile tone="brand" size={38}><Icon name="phone" /></Tile>
            <div className="flex-1"><b className="text-15">Enter your phone code</b><p className="text-13 text-muted">Sent by SMS to {phone}</p></div>
            {!live && <button type="button" className={cn(linkClass, 'text-13')}>Change</button>}
          </div>
          {live
            ? <CodeInput id="phone-code" value={code} onChange={setCode} autoFocus />
            : <CodeBoxes digits="3071" size="lg" />}
          {codeError && <span role="alert" className="text-13 font-medium text-danger-ink">{codeError}</span>}
          <Button type="submit" variant="primary" size="xl" block disabled={live && (code.length !== 6 || confirm.isPending)}>
            {confirm.isPending ? 'Checking…' : 'Confirm'}
          </Button>
          <div className="flex flex-wrap justify-between gap-2 text-13 text-muted">
            {wait.left > 0
              ? <span>Send again in <b className="text-ink tabular-nums">{wait.clock}</b></span>
              : <button type="button" className={cn(linkClass, 'text-13')} disabled={resend.isPending} onClick={() => sendBy('sms')}>Send a new code</button>}
            <span>No SMS? <button type="button" className={cn(linkClass, 'text-13')} disabled={resend.isPending} onClick={() => sendBy('whatsapp')}>Send by WhatsApp</button></span>
          </div>
        </div>
      </AuthForm>
    </AuthShell>
  );
}
