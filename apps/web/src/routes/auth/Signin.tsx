import { Link, useNavigate } from 'react-router-dom';
import AuthShell from '@/layouts/AuthShell';
import PasswordInput from '@/components/PasswordInput';

export default function Signin() {
  const navigate = useNavigate();
  return (
    <AuthShell headline="Welcome back. Your leads are waiting.">
      <form className="dl-auth-form" onSubmit={e => { e.preventDefault(); navigate('/'); }}>
        <div>
          <h2 className="dl-auth-h2">Sign in</h2>
          <p className="dl-auth-sub">Use the email or phone number on your account.</p>
        </div>
        <div className="dl-field">
          <label htmlFor="si-id">Email or phone</label>
          <input id="si-id" className="dl-input" defaultValue="tunde.bakare@gmail.com" />
        </div>
        <div className="dl-field">
          <div className="dl-field-head">
            <label htmlFor="si-pw">Password</label>
            <Link className="dl-link dl-link--sm" to="/forgot">Forgot password?</Link>
          </div>
          <PasswordInput id="si-pw" defaultValue="correct-horse" />
        </div>
        <label className="dl-check dl-check--sm">
          <input type="checkbox" defaultChecked />
          <span>Keep me signed in on this laptop</span>
        </label>
        <button type="submit" className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block dl-btn--xl">Sign in</button>
        <p className="dl-auth-foot">New here? <Link className="dl-link" to="/signup">Create an account</Link></p>
      </form>
    </AuthShell>
  );
}
