import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button, CodeBoxes, CodeInput, Field, Icon, Input, Note, PasswordInput, linkClass, useToast } from '@dialer/ui';
import AuthShell, { AuthFoot, AuthForm, AuthTitle } from '@/layouts/AuthShell';
import { api, errorText } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { fieldError, formError, problemOf, text } from '@/lib/forms';

/**
 * Live: ask for a code first, then enter it with a new password. Demo: both
 * halves at once, as on the board.
 */
export default function Forgot() {
  const navigate = useNavigate();
  const toast = useToast();
  const live = isLive();
  const [login, setLogin] = useState(live ? '' : '+234 803 123 4567');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(!live);

  const forgot = useMutation({
    mutationFn: () => api.post<void>('/auth/forgot', { login }),
    onSuccess: () => setSent(true),
  });
  const reset = useMutation({
    mutationFn: (data: FormData) => api.post<void>('/auth/reset', { login, code, password: text(data, 'password') }),
    onSuccess: () => {
      toast('Password changed. Sign in with your new one.');
      navigate('/signin');
    },
  });
  const problem = problemOf(reset.error);

  function submit(data: FormData) {
    if (!live) navigate('/signin');
    else if (!sent) forgot.mutate();
    else reset.mutate(data);
  }

  return (
    <AuthShell headline="Locked out? Back in two minutes.">
      <AuthForm onSubmit={submit}>
        <AuthTitle title="Reset your password" sub="We send a 6-digit code to your phone, the same way as when you signed up." />
        {forgot.error && <Note tone="danger" className="text-14"><span role="alert">{errorText(forgot.error)}</span></Note>}
        <Field label="Email or phone" htmlFor="fg-id">
          <Input id="fg-id" name="login" autoComplete="username" value={login} readOnly={live && sent}
            onChange={e => setLogin(e.target.value)} />
        </Field>
        {sent && (
          <>
            <div className="flex items-center gap-3 rounded-xl bg-success-soft px-4 py-3.5 text-14" role="status">
              <span className="flex size-[30px] flex-none items-center justify-center rounded-full bg-success text-white"><Icon name="check" size={15} /></span>
              {live
                ? <span>If that matches an account, we sent a code by SMS to its phone.</span>
                : <span>Code sent by SMS to <b>+234 803 •••• 567</b></span>}
            </div>
            {formError(problem) && <Note tone="danger" className="text-14"><span role="alert">{formError(problem)}</span></Note>}
            <Field label="Code" error={fieldError(problem, 'code')}>
              {live ? <CodeInput id="fg-code" value={code} onChange={setCode} size="md" autoFocus /> : <CodeBoxes digits="5194" size="md" />}
            </Field>
            <Field label="New password" htmlFor="fg-pw" end={<span className="text-13 text-muted">At least 10 characters</span>} error={fieldError(problem, 'password')}>
              <PasswordInput id="fg-pw" name="password" autoComplete="new-password" />
            </Field>
          </>
        )}
        <Button type="submit" variant="primary" size="xl" block disabled={forgot.isPending || reset.isPending || (live && !login.trim())}>
          {sent ? 'Save and sign in' : 'Send code'}
        </Button>
        <AuthFoot><Link className={linkClass} to="/signin">Back to sign in</Link></AuthFoot>
      </AuthForm>
    </AuthShell>
  );
}
