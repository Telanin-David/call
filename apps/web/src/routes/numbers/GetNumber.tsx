import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';

type Country = 'us' | 'ca';

const NUMBERS: Record<Country, Array<{ number: string; area: string; location: string }>> = {
  us: [
    { number: '+1 (212) 555-0147', area: '212', location: 'New York, NY' },
    { number: '+1 (646) 555-0120', area: '646', location: 'New York, NY' },
    { number: '+1 (310) 555-0189', area: '310', location: 'Los Angeles, CA' },
    { number: '+1 (312) 555-0134', area: '312', location: 'Chicago, IL' },
    { number: '+1 (415) 555-0176', area: '415', location: 'San Francisco, CA' },
  ],
  ca: [
    { number: '+1 (416) 555-0161', area: '416', location: 'Toronto, ON' },
    { number: '+1 (604) 555-0143', area: '604', location: 'Vancouver, BC' },
    { number: '+1 (514) 555-0198', area: '514', location: 'Montreal, QC' },
  ],
};

export default function GetNumber() {
  const navigate = useNavigate();
  const [country, setCountry] = useState<Country>('us');
  const [area, setArea] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const numbers = NUMBERS[country].filter(n => !area || n.area.startsWith(area));

  return (
    <div className="dl-page" style={{ maxWidth: 720 }}>
      <div>
        <Link to="/setup" className="dl-link" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="i-left" size={13} />
          Setup · step 4 of 6
        </Link>
      </div>

      <div>
        <h1 className="dl-title">Get a US or Canada number</h1>
        <p className="dl-muted" style={{ marginTop: 6 }}>$1.50/month per number. Cancel any time.</p>
      </div>

      {/* Country toggle */}
      <div className="dl-seg" style={{ alignSelf: 'flex-start' }}>
        <button aria-pressed={country === 'us'} onClick={() => setCountry('us')}>🇺🇸 United States</button>
        <button aria-pressed={country === 'ca'} onClick={() => setCountry('ca')}>🇨🇦 Canada</button>
      </div>

      {/* Area code search */}
      <div className="dl-field" style={{ maxWidth: 280 }}>
        <label>Area code (optional)</label>
        <input className="dl-input" placeholder="e.g. 212" value={area} onChange={e => setArea(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        {area && numbers.length > 0 && <span className="dl-hint">{numbers[0]?.location}</span>}
      </div>

      {/* Number list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {numbers.map(n => (
          <label key={n.number} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12,
            border: `1px solid ${selected === n.number ? 'var(--brand)' : 'var(--line)'}`,
            background: selected === n.number ? 'var(--brand-soft)' : 'var(--surface)',
            cursor: 'pointer', boxShadow: selected === n.number ? '0 0 0 1px var(--brand)' : undefined,
          }}>
            <input type="radio" name="number" value={n.number} checked={selected === n.number}
              onChange={() => setSelected(n.number)} style={{ accentColor: 'var(--brand)', width: 16, height: 16 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 15 }}>{n.number}</div>
              <div className="dl-small dl-muted">{n.location}</div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>$1.50/mo</span>
          </label>
        ))}
        {numbers.length === 0 && (
          <div className="dl-empty">
            <Icon name="i-phone" size={24} />
            <span>No numbers found for area code {area}</span>
          </div>
        )}
      </div>

      {selected && (
        <button className="dl-btn dl-btn--primary dl-btn--lg" style={{ alignSelf: 'flex-start' }}
          onClick={() => navigate('/setup')}>
          <Icon name="i-check" size={16} />
          Get {selected}
        </button>
      )}
    </div>
  );
}
