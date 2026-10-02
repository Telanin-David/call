import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatUsd, usd } from '@/lib/money';
import Icon from '@/components/Icon';

type Country = 'us' | 'ca';

const AREAS: Record<Country, { code: string; city: string }> = {
  us: { code: '646', city: 'New York, NY' },
  ca: { code: '416', city: 'Toronto, ON' },
};

const SUFFIXES = ['0142', '0187', '0123', '0199', '0176', '0158'];
const MONTHLY = usd(1, 50);
const BALANCE_NOW = usd(10);

export default function GetNumber() {
  const navigate = useNavigate();
  const [country, setCountry] = useState<Country>('us');
  const [area, setArea] = useState(AREAS.us.code);
  const [picked, setPicked] = useState(0);
  const city = area === AREAS[country].code ? AREAS[country].city : '';
  const numbers = SUFFIXES.map(s => `+1 (${area}) 555-${s}`);
  const chosen = numbers[picked] ?? numbers[0] ?? '';

  function switchCountry(c: Country) {
    setCountry(c);
    setArea(AREAS[c].code);
    setPicked(0);
  }

  return (
    <div className="dl-twocol dl-twocol--340">
      <div className="dl-col dl-col--18">
        <div>
          <Link className="dl-link dl-back" to="/setup"><Icon name="i-left" size={16} />Setup · step 4 of 6</Link>
          <h1 className="dl-h1">Get your number</h1>
          <p className="dl-lede">Pick an area code close to your leads. People are more likely to pick up a local number.</p>
        </div>
        <div className="dl-seg2" role="group" aria-label="Country">
          <button aria-pressed={country === 'us'} onClick={() => switchCountry('us')}>United States</button>
          <button aria-pressed={country === 'ca'} onClick={() => switchCountry('ca')}>Canada</button>
        </div>
        <div className="dl-bigsearch">
          <Icon name="i-pin" />
          <input className="dl-input" aria-label="Area code" inputMode="numeric" value={area}
            onChange={e => setArea(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          {city && <small>{city}</small>}
        </div>
        {area.length === 3 ? (
          <div className="dl-picks" role="radiogroup" aria-label="Available numbers">
            {numbers.map((n, i) => (
              <button key={n} role="radio" className="dl-pick" aria-checked={picked === i} onClick={() => setPicked(i)}>
                <span className="dl-pick-radio" />
                <span className="dl-grow"><b className="dl-num">{n}</b><small>{city ? `${city} · Local number` : 'Local number'}</small></span>
                <span className="dl-pick-price">{formatUsd(MONTHLY)}<span> a month</span></span>
              </button>
            ))}
          </div>
        ) : (
          <p className="dl-hint">Type a 3-digit area code.</p>
        )}
        <button className="dl-link dl-link--14 dl-start">Show more numbers</button>
      </div>

      <aside className="dl-side">
        <div className="dl-darkcard dl-darkcard--lg">
          <div className="dl-hero-eyebrow">YOUR NEW NUMBER</div>
          <div className="dl-darkcard-num dl-num">{chosen}</div>
          <div className="dl-darkcard-sub">{city}</div>
          <div className="dl-darkcard-list">
            <span><Icon name="i-call" size={17} />Leads see this number when you call</span>
            <span><Icon name="i-history" size={17} />They can call you back on it</span>
          </div>
        </div>
        <div className="dl-sumcard">
          <div className="dl-price"><span className="dl-muted">Number, monthly</span><b>{formatUsd(MONTHLY)}</b></div>
          <div className="dl-price"><span className="dl-muted">Balance now</span><b>{formatUsd(BALANCE_NOW)}</b></div>
          <div className="dl-price dl-price--total"><span>Balance after</span><b>{formatUsd(BALANCE_NOW - MONTHLY)}</b></div>
          <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" onClick={() => navigate('/leads/upload?from=setup')}>Rent for {formatUsd(MONTHLY)}</button>
          <span className="dl-fine">Renews every month from your balance on the same date. You can rent as many numbers as you need, $1.50 each. Cancel any one in Numbers. You keep it until the end of the month you paid for.</span>
        </div>
      </aside>
    </div>
  );
}
