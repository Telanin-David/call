import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button, Checkbox, Field, Input, Note, PasswordInput, cn, linkClass } from '@dialer/ui';
import AuthShell, { AuthFoot, AuthForm, AuthTitle } from '@/layouts/AuthShell';
import { api, errorText } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { homeFor, useSetMe, type User } from '@/lib/account';
import { text } from '@/lib/forms';

export default function Signin() {
  const navigate = useNavigate();
  const location = useLocation();
  const setMe = useSetMe();
  const live = isLive();
  const from = (location.state as { from?: string } | null)?.from;

  const signin = useMutation({
    mutationFn: (data: FormData) => api.post<User>('/auth/signin', { login: text(data, 'login'), password: text(data, 'password') }),
    onSuccess: async u => {
      await setMe(u);
      const home = homeFor(u);
      navigate(home === '/' && from ? from : home, { replace: true });
    },
  });

  return (
    <AuthShell headline="Welcome back. Your leads are waiting.">
      <AuthForm onSubmit={data => (live ? signin.mutate(data) : navigate('/'))}>
        <AuthTitle title="Sign in" sub="Use the email or phone number on your account." />
        {signin.error && <Note tone="danger" className="text-14"><span role="alert">{errorText(signin.error)}</span></Note>}
        <Field label="Email or phone" htmlFor="si-id">
          <Input id="si-id" name="login" autoComplete="username" defaultValue={live ? undefined : 'tunde.bakare@gmail.com'} />
        </Field>
        <Field label="Password" htmlFor="si-pw" end={<Link className={cn(linkClass, 'text-13')} to="/forgot">Forgot password?</Link>}>
          <PasswordInput id="si-pw" name="password" autoComplete="current-password" defaultValue={live ? '' : 'correct-horse'} />
        </Field>
        <Checkbox defaultChecked>Keep me signed in on this laptop</Checkbox>
        <Button type="submit" variant="primary" size="xl" block disabled={signin.isPending}>{signin.isPending ? 'Signing in…' : 'Sign in'}</Button>
        <AuthFoot>New here? <Link className={linkClass} to="/signup">Create an account</Link></AuthFoot>
      </AuthForm>
    </AuthShell>
  );
}
