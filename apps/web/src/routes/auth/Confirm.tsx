import { useNavigate } from 'react-router-dom';
import AuthShell from '@/layouts/AuthShell';
import Icon from '@/components/Icon';
import CodeBoxes from '@/components/CodeBoxes';

export default function Confirm() {
  const navigate = useNavigate();
  return (
    <AuthShell signupStep={{ n: 2, label: 'Confirm' }}>
      <div className="dl-auth-form dl-auth-form--wide">
        <div>
          <h2 className="dl-auth-h2">Confirm it's you</h2>
          <p className="dl-auth-sub">Two quick checks so leads only ever hear real people.</p>
        </div>
        <div className="dl-ok">
          <span><Icon name="i-check" /></span>
          <div className="dl-grow"><b>Email confirmed</b><p>tunde.bakare@gmail.com</p></div>
        </div>
        <div className="dl-box">
          <div className="dl-rowhead">
            <span className="dl-tile t-orange"><Icon name="i-phone" /></span>
            <div className="dl-grow"><b>Enter your phone code</b><p>Sent by SMS to +234 803 123 4567</p></div>
            <button type="button" className="dl-link dl-link--sm">Change</button>
          </div>
          <CodeBoxes digits="3071" size="lg" />
          <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block dl-btn--xl" onClick={() => navigate('/setup')}>Confirm</button>
          <div className="dl-split">
            <span>Send again in <b className="dl-num">0:42</b></span>
            <span>No SMS? <a className="dl-link" href="#">Send by WhatsApp</a></span>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
