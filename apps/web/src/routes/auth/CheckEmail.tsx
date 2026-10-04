import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button, Icon, LinkButton, useToast } from '@dialer/ui';
import AuthShell, { AuthForm } from '@/layouts/AuthShell';
import { ME } from '@/lib/fake';
import { api, ApiError, errorText } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { homeFor, useMe } from '@/lib/account';

/** Board 18, step 2: the confirmation link is on its way. */
export default function CheckEmail() {
  const navigate = useNavigate();
  const toast = useToast();
  const live = isLive();
  const me = useMe();
  const [sent, setSent] = useState(1);

  const resend = useMutation({
    mutationFn: () => api.post<void>('/auth/resend', { channel: 'email' }),
    onSuccess: () => setSent(n => n + 1),
    onError: err => toast(errorText(err)),
  });

  async function opened() {
    if (!live) { navigate('/confirm'); return; }
    const r = await me.refetch();
    if (r.data?.email_confirmed) navigate(homeFor(r.data));
    else toast("We haven't seen the link opened yet. Open it from your email, then try again.");
  }

  if (live && me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/signin" replace />;
  const email = live ? me.data?.email ?? '' : ME.email;

  return (
    <AuthShell signupStep={{ n: 2, label: 'Confirm' }}>
      <AuthForm onSubmit={() => void opened()}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="relative flex size-24 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
            <Icon name="mail" size={40} />
            <span aria-hidden="true" className="absolute right-2 top-2 size-4 rounded-full bg-lemon" />
          </span>
          <h2 className="text-28 font-extrabold tracking-[-0.035em] sm:text-32">Check your email</h2>
          <p className="text-15 text-muted">We sent a link to <b className="text-ink">{email}</b>. Open it to carry on.</p>
          <p className="text-13 text-muted" role="status">
            {sent > 1 ? `Sent again. That's ${sent} emails. ` : ''}Nothing after a minute? Check spam.
          </p>
        </div>
        <Button type="submit" variant="primary" size="xl" block disabled={me.isFetching}>I've opened the link</Button>
        <LinkButton className="self-center text-15 font-semibold" disabled={resend.isPending}
          onClick={() => (live ? resend.mutate() : setSent(n => n + 1))}>Send again</LinkButton>
      </AuthForm>
    </AuthShell>
  );
}
