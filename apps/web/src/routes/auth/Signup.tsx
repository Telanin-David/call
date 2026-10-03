import { Link, useNavigate } from 'react-router-dom';
import { Button, Checkbox, Field, Icon, Input, PasswordInput, linkClass } from '@dialer/ui';
import AuthShell, { AuthFoot, AuthForm, AuthTitle } from '@/layouts/AuthShell';

export default function Signup() {
  const navigate = useNavigate();
  return (
    <AuthShell signupStep={{ n: 1, label: 'Create account' }}>
      <AuthForm onSubmit={() => navigate('/confirm')}>
        <AuthTitle title="Create your account" sub="Free to start. No card needed." />
        <Field label="Full name" htmlFor="su-name" hint="Use the name on your ID. Your card name must match it later.">
          <Input id="su-name" defaultValue="Tunde Bakare" />
        </Field>
        <Field label="Email" htmlFor="su-email">
          <Input id="su-email" type="email" defaultValue="tunde.bakare@gmail.com" />
        </Field>
        <Field label="Phone number" htmlFor="su-phone" hint="We send a 6-digit code here.">
          <div className="flex gap-2">
            <button type="button" className="flex h-11 flex-none cursor-pointer items-center gap-2 rounded-sm border border-line-strong bg-surface px-3 font-semibold">
              <small className="text-13 text-muted">NG</small>+234<Icon name="right" size={14} className="rotate-90 text-faint" />
            </button>
            <Input id="su-phone" type="tel" defaultValue="803 123 4567" />
          </div>
        </Field>
        <Field label="Password" htmlFor="su-pw" hint="At least 10 characters.">
          <PasswordInput id="su-pw" defaultValue="correct-horse" />
        </Field>
        <Checkbox defaultChecked>
          I agree to the <a className={linkClass} href="#">rules</a> and <a className={linkClass} href="#">terms</a>. One account per person.
        </Checkbox>
        <Button type="submit" variant="primary" size="xl" block>Create account</Button>
        <AuthFoot>Have an account? <Link className={linkClass} to="/signin">Sign in</Link></AuthFoot>
      </AuthForm>
    </AuthShell>
  );
}
