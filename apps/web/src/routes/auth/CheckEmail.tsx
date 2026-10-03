import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, LinkButton } from '@dialer/ui';
import AuthShell, { AuthForm } from '@/layouts/AuthShell';
import { ME } from '@/lib/fake';

/** Board 18, step 2: the confirmation link is on its way. */
export default function CheckEmail() {
  const navigate = useNavigate();
  const [sent, setSent] = useState(1);
  return (
    <AuthShell signupStep={{ n: 2, label: 'Confirm' }}>
      <AuthForm onSubmit={() => navigate('/confirm')}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="relative flex size-24 items-center justify-center rounded-full bg-brand-tint text-brand-ink">
            <Icon name="mail" size={40} />
            <span aria-hidden="true" className="absolute right-2 top-2 size-4 rounded-full bg-lemon" />
          </span>
          <h2 className="text-28 font-extrabold tracking-[-0.035em] sm:text-32">Check your email</h2>
          <p className="text-15 text-muted">We sent a link to <b className="text-ink">{ME.email}</b>. Open it to carry on.</p>
          <p className="text-13 text-muted" role="status">
            {sent > 1 ? `Sent again. That's ${sent} emails. ` : ''}Nothing after a minute? Check spam.
          </p>
        </div>
        <Button type="submit" variant="primary" size="xl" block>I've opened the link</Button>
        <LinkButton className="self-center text-15 font-semibold" onClick={() => setSent(n => n + 1)}>Send again</LinkButton>
      </AuthForm>
    </AuthShell>
  );
}
