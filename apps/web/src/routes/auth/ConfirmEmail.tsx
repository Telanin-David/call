import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon, buttonClass } from '@dialer/ui';
import AuthShell, { AuthTitle } from '@/layouts/AuthShell';
import { api, errorText } from '@/lib/api';
import { homeFor, keys, useMe } from '@/lib/account';
import { isLive } from '@/lib/backend';

/**
 * Where the link in the confirmation email lands. It works without being
 * signed in, so the rep can open the email on their phone.
 */
export default function ConfirmEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const qc = useQueryClient();
  // Demo mode has no api: the link always "works".
  const confirm = useQuery({
    queryKey: ['confirm-email', token],
    queryFn: async () => {
      if (!isLive()) return true;
      await api.post<void>('/auth/confirm/email', { token });
      // The account changed: anything showing it must reload.
      await qc.invalidateQueries({ queryKey: keys.me });
      return true;
    },
    retry: false,
    staleTime: Infinity,
  });
  const me = useMe();
  const next = me.data ? homeFor({ ...me.data, email_confirmed: true }) : '/signin';

  return (
    <AuthShell signupStep={{ n: 2, label: 'Confirm' }}>
      <div className="flex w-full max-w-[420px] flex-col gap-[22px]" role="status">
        {confirm.isPending && <AuthTitle title="Confirming your email…" sub="One moment." />}
        {confirm.isSuccess && (
          <>
            <span className="flex size-16 items-center justify-center rounded-full bg-success text-white"><Icon name="check" size={30} /></span>
            <AuthTitle title="Email confirmed" sub={me.data ? 'Next, the code we sent to your phone.' : 'Go back to the tab where you signed up, or sign in here.'} />
            <Link to={next} className={buttonClass({ variant: 'primary', size: 'xl', block: true })}>{me.data ? 'Carry on' : 'Sign in'}</Link>
          </>
        )}
        {confirm.isError && (
          <>
            <AuthTitle title="That link didn't work" sub={errorText(confirm.error)} />
            <Link to="/signin" className={buttonClass({ variant: 'primary', size: 'xl', block: true })}>Sign in</Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
