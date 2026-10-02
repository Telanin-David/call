import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlan } from '@/lib/plan';
import Icon from '@/components/Icon';

const QUEUE = [
  { name: 'Sandra Mensah', company: 'Buildright Ltd', status: 'done', avatar: 'SM', av: 'dl-av-c' },
  { name: 'James Obi', company: 'Obi Ventures', status: 'current', avatar: 'JO', av: 'dl-av-a' },
  { name: 'Amara Diallo', company: 'Diallo & Co', status: 'next', avatar: 'AD', av: 'dl-av-b' },
  { name: 'Kofi Asante', company: 'GoldCoast Capital', status: 'next', avatar: 'KA', av: 'dl-av-e' },
  { name: 'Yewande Bello', company: 'Bello Properties', status: 'next', avatar: 'YB', av: 'dl-av-d' },
];

const OUTCOMES = [
  { key: 'interested', label: 'Interested', icon: 'i-spark', color: 'mint' },
  { key: 'callback', label: 'Call back', icon: 'i-callback', color: 'orange' },
  { key: 'no_answer', label: 'No answer', icon: 'i-missed', color: 'grey' },
  { key: 'not_interested', label: 'Not interested', icon: 'i-wrong', color: 'grey' },
  { key: 'wrong_number', label: 'Wrong number', icon: 'i-ban', color: 'red' },
  { key: 'voicemail', label: 'Left voicemail', icon: 'i-mic', color: 'lemon' },
];

type CallState = 'ready' | 'ringing' | 'live' | 'ended';
type HowToTalk = 'laptop' | 'phone';

export default function Calling() {
  const navigate = useNavigate();
  const { plan } = usePlan();
  const [callState, setCallState] = useState<CallState>('ready');
  const [how, setHow] = useState<HowToTalk>('laptop');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [phoneLinked] = useState(plan !== 'free');

  const canStart = how === 'laptop' || phoneLinked;

  function startCall() {
    setCallState('ringing');
    setTimeout(() => setCallState('live'), 1500);
  }

  function endCall() {
    setCallState('ended');
  }

  function nextLead() {
    setCallState('ready');
    setOutcome(null);
    setMuted(false);
  }

  return (
    <div className="dl" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-sunk)' }}>
      {/* Topbar */}
      <header className="dl-topbar">
        <span className="dl-brand" style={{ color: 'var(--ink)', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <span className="dl-brand-mark" />
          Dialer
        </span>
        <nav style={{ marginLeft: 20, display: 'flex', gap: 4 }}>
          {['Today', 'Leads', 'Scripts', 'Follow-ups', 'History'].map(l => (
            <span key={l} style={{ height: 36, display: 'inline-flex', alignItems: 'center', padding: '0 12px', borderRadius: 8, fontSize: 14, fontWeight: 500, color: 'var(--muted)', cursor: 'pointer' }}
              onClick={() => navigate(l === 'Today' ? '/' : '/' + l.toLowerCase().replace('-', ''))}>
              {l}
            </span>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Sound device button */}
          <button className={`dl-device ${how === 'phone' && phoneLinked ? '' : 'dl-device--off'}`}>
            <span className="ico">
              <Icon name="i-phone" size={14} />
            </span>
            <span>
              {how === 'laptop' ? 'Browser audio' : phoneLinked ? 'Phone connected' : 'Not connected'}
              <small>{how === 'laptop' ? 'Using laptop speakers' : phoneLinked ? '+1 (555) 000-1234' : 'Choose how to talk'}</small>
            </span>
          </button>
          <span className={`dl-pill ${plan === 'free' ? '' : plan === 'starter' ? 'dl-pill--warn' : 'dl-pill--success'}`}>
            {plan === 'free' ? 'Free' : plan === 'starter' ? 'Starter' : 'Pro'}
          </span>
          <div className="dl-money"><b>$24.51</b><span>balance</span></div>
          <button className="dl-btn dl-btn--primary" style={{ height: 34, padding: '0 14px', fontSize: 13 }}>Top up</button>
          <button className="dl-avatar" style={{ border: 0, cursor: 'pointer' }}>TU</button>
        </div>
      </header>

      {/* 3-column body */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '288px minmax(0,1fr) 380px', minHeight: 0 }}>
        {/* Queue sidebar */}
        <aside style={{ background: 'var(--surface)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px 12px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Queue</span>
            <span className="dl-small dl-muted">5 leads</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 8px' }}>
            {QUEUE.map((q, i) => (
              <div key={q.name} className={`dl-q2 ${q.status === 'current' ? 'is-current' : q.status === 'done' ? 'is-done' : ''}`}>
                <span className={`av ${q.av}`}>{q.avatar}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nm">{q.name}</div>
                  <div className="sm">{q.company}</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>{i + 1}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
            <div className="dl-meter" style={{ marginBottom: 12 }}>
              <div className="dl-meter-row"><span>Dials today</span><span>1 / 120</span></div>
              <div className="dl-progress"><span style={{ width: '1%' }} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="dl-btn dl-btn--outline" style={{ flex: 1, height: 36, fontSize: 13 }}
                aria-pressed={paused}
                onClick={() => setPaused(p => !p)}>
                <Icon name="i-pause" size={14} />
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button className="dl-btn dl-btn--outline" style={{ flex: 1, height: 36, fontSize: 13 }}>
                <Icon name="i-skip" size={14} />
                Skip
              </button>
            </div>
          </div>
        </aside>

        {/* Main lead + script */}
        <main style={{ overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="dl-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span className="dl-avlg dl-av-a">JO</span>
              <div>
                <h2 className="dl-lead-name">James Obi</h2>
                <div className="dl-lead-meta">
                  <span>CEO</span>
                  <span>·</span>
                  <span>Obi Ventures</span>
                  <span>·</span>
                  <span>Lagos, NG</span>
                </div>
              </div>
            </div>
            <div className="dl-facts">
              {[
                { label: 'Phone', value: '+234 801 234 5678', icon: 'i-call' },
                { label: 'Email', value: 'james@obiventures.ng', icon: 'i-mail' },
                { label: 'Location', value: 'Lagos, Nigeria', icon: 'i-pin' },
                { label: 'Company', value: 'Obi Ventures', icon: 'i-building' },
                { label: 'Website', value: 'obiventures.ng', icon: 'i-globe' },
                { label: 'List', value: 'Lagos CEOs Q4', icon: 'i-list' },
              ].map(f => (
                <div key={f.label} className="dl-fact">
                  <span><Icon name={f.icon} size={12} />{f.label}</span>
                  <b>{f.value}</b>
                </div>
              ))}
            </div>
            <div className="dl-conclusion">
              <b>Last call</b>
              <span>No answer — tried 1 of 3 times</span>
            </div>
          </div>

          {/* Script */}
          <div className="dl-paper">
            <div className="dl-sc">
              <h4>Opening</h4>
              <p>Hey <span className="dl-merge">James</span>, this is Tunde calling — quick 30-second interruption. Does that work?</p>
              <h4>Value prop</h4>
              <p>I help <span className="dl-merge">CEOs</span> in <span className="dl-merge">Lagos</span> close more deals using targeted US and Canada call lists. We've helped similar companies increase their pipeline by 3×.</p>
              <h4>Close</h4>
              <p>Do you have 15 minutes this week to see if it's a fit?</p>
            </div>
          </div>
        </main>

        {/* Right call panel */}
        <aside style={{ background: 'var(--surface)', borderLeft: '1px solid var(--line)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
          <div className="dl-callcard">
            {/* State indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className={`dl-callstate ${callState === 'live' ? 'dl-callstate--live' : callState === 'ringing' ? 'dl-callstate--dial' : ''}`}>
                <span className="dl-dot dl-dot--pulse" style={{ background: callState === 'live' ? 'var(--success)' : callState === 'ringing' ? 'var(--brand)' : 'var(--faint)' }} />
                {callState === 'ready' ? 'READY' : callState === 'ringing' ? 'DIALLING…' : callState === 'live' ? 'LIVE' : 'ENDED'}
              </span>
              {plan === 'pro' && <span className="rec"><i />REC</span>}
            </div>

            {/* Timer */}
            <div className="tm">
              {callState === 'live' ? '0:04' : callState === 'ringing' ? '…' : '0:00'}
            </div>

            {/* Clocks */}
            <div className="dl-clocks">
              <div className="dl-clock is-them">
                <span>Their time</span>
                <b>3:14 am</b>
              </div>
              <div className="dl-clock">
                <span>Your time</span>
                <b>9:14 am</b>
              </div>
            </div>

            {/* Balance */}
            <div className="dl-cost">
              <span>Balance</span>
              <b>$24.51</b>
            </div>

            {/* Live controls */}
            {callState === 'live' && (
              <div style={{ display: 'flex', justifyContent: 'space-around', paddingTop: 4 }}>
                <button className="dl-round" aria-pressed={muted} onClick={() => setMuted(m => !m)}>
                  <span><Icon name={muted ? 'i-micoff' : 'i-mic'} size={22} /></span>
                  {muted ? 'Unmute' : 'Mute'}
                </button>
                <button className="dl-round dl-round--end" onClick={endCall}>
                  <span><Icon name="i-hangup" size={22} /></span>
                  End call
                </button>
              </div>
            )}
          </div>

          {/* How will you talk? */}
          {callState === 'ready' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'var(--faint)', textTransform: 'uppercase', marginBottom: 10 }}>
                How will you talk?
              </div>
              <div className="dl-how" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="dl-choice" aria-checked={how === 'laptop'} onClick={() => setHow('laptop')}>
                  <span className="dl-tile dl-tile--brand"><Icon name="i-laptop" size={18} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Laptop</div>
                    <div className="dl-mini">Use your browser microphone</div>
                  </div>
                  <span className="dl-radio" />
                </button>
                <button className="dl-choice" aria-checked={how === 'phone'}
                  onClick={() => plan !== 'free' && setHow('phone')}
                  style={{ opacity: plan === 'free' ? .5 : 1, cursor: plan === 'free' ? 'not-allowed' : 'pointer' }}>
                  <span className={`dl-tile ${phoneLinked ? 'dl-tile--mint' : 'dl-tile--lemon'}`}>
                    <Icon name="i-phone" size={18} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Phone {plan === 'free' && <span className="dl-pill" style={{ fontSize: 11 }}>Starter+</span>}</div>
                    <div className="dl-mini">{phoneLinked ? 'Phone linked · +1 (555) 000-1234' : 'Link your phone'}</div>
                  </div>
                  <span className="dl-radio" />
                </button>
              </div>

              {how === 'phone' && !phoneLinked && (
                <div className="dl-banner dl-banner--lemon" style={{ marginTop: 10 }}>
                  <Icon name="i-phone" size={16} />
                  <span>Phone not connected. <button className="dl-link" style={{ fontSize: 14 }}>Link phone →</button></span>
                </div>
              )}

              <button
                className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block"
                style={{ marginTop: 14 }}
                disabled={!canStart}
                aria-disabled={!canStart}
                onClick={startCall}
              >
                <Icon name="i-call" size={16} />
                Start calling
              </button>
            </div>
          )}

          {/* Outcomes after call */}
          {callState === 'ended' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'var(--faint)', textTransform: 'uppercase', marginBottom: 10 }}>
                What happened?
              </div>
              <div className="dl-outcomes">
                {OUTCOMES.map(o => (
                  <button key={o.key} className="dl-orow" aria-pressed={outcome === o.key}
                    onClick={() => setOutcome(o.key)}>
                    <span className={`dl-tile t-${o.color}`}><Icon name={o.icon} size={16} /></span>
                    {o.label}
                  </button>
                ))}
              </div>
              <button className="dl-btn dl-btn--primary dl-btn--lg dl-btn--block" style={{ marginTop: 14 }}
                onClick={nextLead}>
                <Icon name="i-right" size={16} />
                Next lead
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
