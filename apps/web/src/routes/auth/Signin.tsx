import { Link, useNavigate } from 'react-router-dom';
import { Button, Checkbox, Field, Input, PasswordInput, cn, linkClass } from '@dialer/ui';
import AuthShell, { AuthFoot, AuthForm, AuthTitle } from '@/layouts/AuthShell';

export default function Signin() {
  const navigate = useNavigate();
  return (
    <AuthShell headline="Welcome back. Your leads are waiting.">
      <AuthForm onSubmit={() => navigate('/')}>
        <AuthTitle title="Sign in" sub="Use the email or phone number on your account." />
        <Field label="Email or phone" htmlFor="si-id">
          <Input id="si-id" defaultValue="tunde.bakare@gmail.com" />
        </Field>
        <Field label="Password" htmlFor="si-pw" end={<Link className={cn(linkClass, 'text-13')} to="/forgot">Forgot password?</Link>}>
          <PasswordInput id="si-pw" defaultValue="correct-horse" />
        </Field>
        <Checkbox defaultChecked>Keep me signed in on this laptop</Checkbox>
        <Button type="submit" variant="primary" size="xl" block>Sign in</Button>
        <AuthFoot>New here? <Link className={linkClass} to="/signup">Create an account</Link></AuthFoot>
      </AuthForm>
    </AuthShell>
  );
}
