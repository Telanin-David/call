import { Link, useNavigate } from 'react-router-dom';
import AuthShell from '@/layouts/AuthShell';
import Icon from '@/components/Icon';
import CodeBoxes from '@/components/CodeBoxes';

export default function Forgot() {
  const navigate = useNavigate();
  return (
    <AuthShell headline="Locked out? Back in two minutes.">
      <form className="dl-auth-form" onSubmit={e => { e.preventDefault(); navigate('/signin'); }}>
        <div>
          <h2 className="dl-auth-h2">Reset your password</h2>
          <p className="dl-auth-sub">We send a 6-digit code to your phone, the same way as when you signed up.</p>
        </div>
        <div className="dl-field">
          <label htmlFor="fg-id">Email or phone</label>
          <input id="fg-id" className="dl-input" defaultValue="+234 803 123 4567" />
        </div>
        <div className="dl-ok dl-ok--sm">
          <span><Icon name="i-check" size={15} /></span>
          <span>Code sent by SMS to <b>+234 803 •••• 567</b></span>
        </div>
        <div className="dl-field">
          <label>Code</label>
          <CodeBoxes digits="5194" size="md" />
        </div>
        <div className="dl-field">
          <div className="dl-field-head">
            <label htmlFor="fg-pw">New password</label>
            <span className="dl-hint">At least 10 characters</span>
          </div>
          <input id="fg-pw" className="dl-input" type="password" />
        </div>
        <button type="submit" className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block dl-btn--xl">Save and sign in</button>
        <p className="dl-auth-foot"><Link className="dl-link" to="/signin">Back to sign in</Link></p>
      </form>
    </AuthShell>
  );
}
