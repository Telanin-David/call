import { Link, useNavigate } from 'react-router-dom';
import { Button, CodeBoxes, Field, Icon, Input, linkClass } from '@dialer/ui';
import AuthShell, { AuthFoot, AuthForm, AuthTitle } from '@/layouts/AuthShell';

export default function Forgot() {
  const navigate = useNavigate();
  return (
    <AuthShell headline="Locked out? Back in two minutes.">
      <AuthForm onSubmit={() => navigate('/signin')}>
        <AuthTitle title="Reset your password" sub="We send a 6-digit code to your phone, the same way as when you signed up." />
        <Field label="Email or phone" htmlFor="fg-id">
          <Input id="fg-id" defaultValue="+234 803 123 4567" />
        </Field>
        <div className="flex items-center gap-3 rounded-xl bg-success-soft px-4 py-3.5 text-14">
          <span className="flex size-[30px] flex-none items-center justify-center rounded-full bg-success text-white"><Icon name="check" size={15} /></span>
          <span>Code sent by SMS to <b>+234 803 •••• 567</b></span>
        </div>
        <Field label="Code">
          <CodeBoxes digits="5194" size="md" />
        </Field>
        <Field label="New password" htmlFor="fg-pw" end={<span className="text-13 text-muted">At least 10 characters</span>}>
          <Input id="fg-pw" type="password" />
        </Field>
        <Button type="submit" variant="primary" size="xl" block>Save and sign in</Button>
        <AuthFoot><Link className={linkClass} to="/signin">Back to sign in</Link></AuthFoot>
      </AuthForm>
    </AuthShell>
  );
}
