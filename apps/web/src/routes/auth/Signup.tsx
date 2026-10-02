import { Link, useNavigate } from 'react-router-dom';
import AuthShell from '@/layouts/AuthShell';
import Icon from '@/components/Icon';
import PasswordInput from '@/components/PasswordInput';

export default function Signup() {
  const navigate = useNavigate();
  return (
    <AuthShell signupStep={{ n: 1, label: 'Create account' }}>
      <form className="dl-auth-form" onSubmit={e => { e.preventDefault(); navigate('/confirm'); }}>
        <div>
          <h2 className="dl-auth-h2">Create your account</h2>
          <p className="dl-auth-sub">Free to start. No card needed.</p>
        </div>
        <div className="dl-field">
          <label htmlFor="su-name">Full name</label>
          <input id="su-name" className="dl-input" defaultValue="Tunde Bakare" />
          <span className="dl-hint">Use the name on your ID. Your card name must match it later.</span>
        </div>
        <div className="dl-field">
          <label htmlFor="su-email">Email</label>
          <input id="su-email" className="dl-input" type="email" defaultValue="tunde.bakare@gmail.com" />
        </div>
        <div className="dl-field">
          <label htmlFor="su-phone">Phone number</label>
          <div className="dl-row">
            <button type="button" className="dl-input dl-cc"><small>NG</small>+234<Icon name="i-right" size={14} /></button>
            <input id="su-phone" className="dl-input dl-grow" type="tel" defaultValue="803 123 4567" />
          </div>
          <span className="dl-hint">We send a 6-digit code here.</span>
        </div>
        <div className="dl-field">
          <label htmlFor="su-pw">Password</label>
          <PasswordInput id="su-pw" defaultValue="correct-horse" />
          <span className="dl-hint">At least 10 characters.</span>
        </div>
        <label className="dl-check dl-check--sm">
          <input type="checkbox" defaultChecked />
          <span>I agree to the <a className="dl-link" href="#">rules</a> and <a className="dl-link" href="#">terms</a>. One account per person.</span>
        </label>
        <button type="submit" className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block dl-btn--xl">Create account</button>
        <p className="dl-auth-foot">Have an account? <Link className="dl-link" to="/signin">Sign in</Link></p>
      </form>
    </AuthShell>
  );
}
