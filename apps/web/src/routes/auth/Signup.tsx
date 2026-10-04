import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button, Checkbox, Field, Input, Note, PasswordInput, Select, linkClass, useToast } from '@dialer/ui';
import AuthShell, { AuthFoot, AuthForm, AuthTitle } from '@/layouts/AuthShell';
import { api } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { useSetMe, type User } from '@/lib/account';
import { COUNTRIES, fieldError, formError, fullPhone, localTimeZone, problemOf, text } from '@/lib/forms';

export default function Signup() {
  const navigate = useNavigate();
  const toast = useToast();
  const setMe = useSetMe();
  const live = isLive();
  const [country, setCountry] = useState<string>('NG');
  const dial = COUNTRIES.find(c => c.code === country)?.dial ?? '234';

  const signup = useMutation({
    mutationFn: (data: FormData) => api.post<User>('/auth/signup', {
      name: text(data, 'name'),
      email: text(data, 'email'),
      phone: fullPhone(text(data, 'phone'), dial),
      password: text(data, 'password'),
      country,
      timezone: localTimeZone(),
      accept_rules: data.get('rules') === 'on',
    }),
    onSuccess: u => setMe(u).then(() => navigate('/check-email')),
  });
  const problem = problemOf(signup.error);

  return (
    <AuthShell signupStep={{ n: 1, label: 'Create account' }}>
      <AuthForm onSubmit={data => (live ? signup.mutate(data) : navigate('/check-email'))}>
        <AuthTitle title="Create your account" sub="Free to start. No card needed." />
        {formError(problem) && <Note tone="danger" className="text-14"><span role="alert">{formError(problem)}</span></Note>}
        <Field label="Full name" htmlFor="su-name" hint="Use the name on your ID. Your card name must match it later." error={fieldError(problem, 'name')}>
          <Input id="su-name" name="name" autoComplete="name" defaultValue={live ? undefined : 'Tunde Bakare'} />
        </Field>
        <Field label="Email" htmlFor="su-email" error={fieldError(problem, 'email')}>
          <Input id="su-email" name="email" type="email" autoComplete="email" defaultValue={live ? undefined : 'tunde.bakare@gmail.com'} />
        </Field>
        <Field label="Phone number" htmlFor="su-phone" hint="We send a 6-digit code here." error={fieldError(problem, 'phone')}>
          <div className="flex gap-2">
            <Select aria-label="Country" value={country} onChange={e => setCountry(e.target.value)} className="w-auto flex-none font-semibold">
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.code} +{c.dial}</option>)}
            </Select>
            <Input id="su-phone" name="phone" type="tel" autoComplete="tel-national" defaultValue={live ? undefined : '803 123 4567'} />
          </div>
        </Field>
        <Field label="Password" htmlFor="su-pw" hint="At least 10 characters." error={fieldError(problem, 'password')}>
          <PasswordInput id="su-pw" name="password" autoComplete="new-password" defaultValue={live ? '' : 'correct-horse'} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <Checkbox name="rules" defaultChecked={!live}>
            I agree to the <Link className={linkClass} to="/rules">rules</Link> and <button type="button" className={linkClass} onClick={() => toast('The full terms are added before launch. The rules cover how the app works.')}>terms</button>. One account per person.
          </Checkbox>
          {fieldError(problem, 'rules') && <span role="alert" className="text-13 font-medium text-danger-ink">{fieldError(problem, 'rules')}</span>}
        </div>
        <Button type="submit" variant="primary" size="xl" block disabled={signup.isPending}>
          {signup.isPending ? 'Creating your account…' : 'Create account'}
        </Button>
        <AuthFoot>Have an account? <Link className={linkClass} to="/signin">Sign in</Link></AuthFoot>
      </AuthForm>
    </AuthShell>
  );
}
