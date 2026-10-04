import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Brand, Button, Icon, Input, LinkButton, Tile, cn, linkClass, type IconName } from '@dialer/ui';
import { formatUsd3 } from '@/lib/money';
import { RATE_PER_MIN } from '@/lib/pricing';

type Step = 'intro' | 'scan' | 'mic' | 'blocked' | 'linked' | 'call';

/** Phone and laptop drawn with plain boxes; `linked` turns the dashed line into a solid one with a tick. */
function Devices({ linked }: { linked?: boolean }) {
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-2 rounded-3xl bg-brand-tint px-6 py-7">
      <span className="h-[92px] w-[50px] rounded-[12px] border-4 border-night bg-night" />
      <span className={cn('flex w-14 items-center', linked ? 'border-t-2 border-success' : 'border-t-2 border-dashed border-tangerine')}>
        <span className={cn('mx-auto -mt-[7px] flex size-3 items-center justify-center rounded-full', linked ? 'size-4 bg-success text-white' : 'bg-success')}>
          {linked && <Icon name="check" size={10} />}
        </span>
      </span>
      <span className="flex flex-col items-center">
        <span className="h-[70px] w-[112px] rounded-t-[10px] border-4 border-night bg-surface" />
        <span className="h-2 w-[136px] rounded-b-md bg-night" />
      </span>
    </div>
  );
}

function Screen({ dark, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <div className={cn('min-h-dvh', dark ? 'bg-night text-white' : 'bg-sunk text-ink')}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-5 px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        {children}
      </div>
    </div>
  );
}

function StatusRow({ icon, tone, label, value, ok }: { icon: IconName; tone: string; label: string; value: string; ok?: boolean }) {
  return (
    <li className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
      <span className={cn('flex size-8 flex-none items-center justify-center rounded-lg text-white', tone)}><Icon name={icon} size={16} /></span>
      <b className="flex-1 text-15">{label}</b>
      <span className={cn('text-14', ok ? 'text-success-ink' : 'text-muted')}>{value}</span>
    </li>
  );
}

function RoundButton({ icon, label, danger, pressed, onClick }: { icon: IconName; label: string; danger?: boolean; pressed?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed}
      className="flex cursor-pointer flex-col items-center gap-2 border-0 bg-transparent text-12 font-semibold text-white">
      <span className={cn('flex items-center justify-center rounded-full', danger ? 'size-16 bg-danger' : 'size-14 bg-white/12', pressed && 'bg-white text-night')}>
        <Icon name={icon} size={danger ? 26 : 22} />
      </span>
      {label}
    </button>
  );
}

export default function LinkPhone() {
  const [step, setStep] = useState<Step>('intro');
  const [typing, setTyping] = useState(false);
  const [found, setFound] = useState(false);
  const [seconds, setSeconds] = useState(134);
  const [muted, setMuted] = useState(false);
  const [leftScreen, setLeftScreen] = useState(false);

  useEffect(() => {
    if (step !== 'scan') return;
    setFound(false);
    const t = setTimeout(() => setFound(true), 1200);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (step !== 'call') return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (step !== 'linked' && step !== 'call') return;
    const onVis = () => { if (document.visibilityState === 'visible') setLeftScreen(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [step]);

  async function askMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setStep('linked');
    } catch {
      setStep('blocked');
    }
  }

  if (step === 'scan') {
    return (
      <Screen dark>
        <button type="button" aria-label="Close" onClick={() => setStep('intro')}
          className="flex size-9 cursor-pointer items-center justify-center self-start rounded-full border-0 bg-white/12 text-white">
          <Icon name="x" size={16} />
        </button>
        <div className="flex flex-1 items-center justify-center">
          <div className="rounded-3xl border-4 border-sun p-4">
            <img src="/qr-demo.svg" alt="" className="size-48 rotate-[-4deg] rounded-xl bg-white p-3" />
          </div>
        </div>
        <p className="text-center text-14 text-zinc-400">Point your camera at the code on your laptop.</p>
        {found && (
          <div className="flex items-center gap-3 rounded-2xl bg-surface p-3 text-ink">
            <Tile tone="grey" size={36} className="bg-night text-white"><Icon name="laptop" size={17} /></Tile>
            <span className="flex-1"><b className="block text-15">Tunde's laptop</b><span className="text-12 text-muted">Chrome · Lagos</span></span>
            <Button variant="primary" className="h-9 rounded-full" onClick={() => setStep('mic')}>Connect</Button>
          </div>
        )}
      </Screen>
    );
  }

  if (step === 'mic' || step === 'blocked') {
    const blocked = step === 'blocked';
    return (
      <Screen>
        <div className="flex items-center">
          <LinkButton className="flex items-center gap-1 text-15" onClick={() => setStep('intro')}><Icon name="left" size={16} />Back</LinkButton>
          <b className="flex-1 pr-12 text-center text-15">Step 2 of 3</b>
        </div>
        {blocked ? (
          <>
            <h1 className="text-32 font-extrabold tracking-[-0.035em]">Allow the mic</h1>
            <p className="text-15 text-muted">Your browser blocked the microphone, so you can't talk on calls yet.</p>
            <ol className="flex list-none flex-col rounded-2xl bg-surface">
              {['Tap the icon left of the web address', 'Tap Permissions or Site settings, then Microphone', 'Choose Allow', 'Come back and tap Try again'].map((t, i) => (
                <li key={t} className="flex items-center gap-3 border-t border-line px-4 py-3.5 text-15 font-semibold first:border-t-0">
                  <span className="flex size-6 flex-none items-center justify-center rounded-full bg-tangerine text-12 font-bold text-night">{i + 1}</span>{t}
                </li>
              ))}
            </ol>
            <p className="text-13 text-muted">Still stuck? In your phone's settings, find your browser and turn on Microphone.</p>
            <span className="flex-1" />
            <Button variant="primary" size="xl" block onClick={askMic}>Try again</Button>
          </>
        ) : (
          <>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-[72px] items-center justify-center rounded-3xl bg-tangerine text-night"><Icon name="mic" size={32} /></span>
              <h1 className="text-28 font-extrabold tracking-[-0.03em]">Let them hear you</h1>
              <p className="text-15 text-muted">We only use the mic during calls. Your browser will ask once.</p>
            </div>
            <Button variant="primary" size="xl" block onClick={askMic}>Allow microphone</Button>
          </>
        )}
      </Screen>
    );
  }

  if (step === 'call') {
    return (
      <Screen dark>
        <p className="flex items-center justify-center gap-1.5 text-13 text-zinc-400"><Icon name="laptop" size={14} />Dialer · script on your laptop</p>
        <div className="text-center">
          <h1 className="text-32 font-extrabold tracking-[-0.03em]">Lena Park</h1>
          <p className="text-17 tabular-nums text-zinc-300">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p>
          <div className="mt-3 flex justify-center gap-2 text-12 font-bold">
            <span className="rounded-full bg-white/10 px-2.5 py-1">Their time 3:14 pm</span>
            <span className="rounded-full bg-tangerine/20 px-2.5 py-1 text-glow">{formatUsd3(Math.round((RATE_PER_MIN.starter * seconds) / 60))}</span>
          </div>
        </div>
        {leftScreen && (
          <div className="flex flex-col gap-2 rounded-3xl bg-tangerine p-4 text-night">
            <b className="flex items-center gap-2 text-17"><Icon name="phone" />Keep this screen open</b>
            <p className="text-14">Your phone is the mic and speaker for the laptop. If you lock it or switch apps, Lena can't hear you.</p>
            <Button className="mt-1 bg-white text-night hover:bg-white" onClick={() => setLeftScreen(false)}>Got it</Button>
          </div>
        )}
        <span className="flex-1" />
        <div className="flex justify-center gap-8">
          <RoundButton icon={muted ? 'micoff' : 'mic'} label={muted ? 'Unmute' : 'Mute'} pressed={muted} onClick={() => setMuted(m => !m)} />
          <RoundButton icon="note" label="Note" />
          <RoundButton icon="users" label="Details" />
        </div>
        <div className="flex justify-center pb-4"><RoundButton icon="hangup" label="End" danger onClick={() => setStep('linked')} /></div>
      </Screen>
    );
  }

  if (step === 'linked') {
    return (
      <Screen>
        <div className="flex justify-end"><Link to="/" className={cn(linkClass, 'text-15')}>Done</Link></div>
        <Devices linked />
        <div className="text-center">
          <h1 className="text-28 font-extrabold tracking-[-0.03em]">Linked</h1>
          <p className="mt-1 text-15 text-muted">Press Start calling on your laptop. Calls come through this phone.</p>
        </div>
        <ul className="flex list-none flex-col rounded-2xl bg-surface">
          <StatusRow icon="laptop" tone="bg-night" label="Laptop" value="Chrome, Lagos" />
          <StatusRow icon="mic" tone="bg-success" label="Microphone" value="Working" ok />
          <StatusRow icon="phone" tone="bg-tangerine" label="Battery" value="64%" />
        </ul>
        <div className="flex items-center gap-3 rounded-2xl bg-surface p-4">
          <Tile tone="lemon" size={34}><Icon name="sun" size={17} /></Tile>
          <span><b className="block text-15">Keep the screen on</b><span className="text-13 text-muted">If it turns off, calls pause.</span></span>
        </div>
        <Button variant="outline" size="lg" block onClick={() => setStep('call')}>Show a test call</Button>
        <Button variant="outlineDanger" size="lg" block onClick={() => setStep('intro')}>Unlink</Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex items-center justify-between">
        <Link to="/" className={cn(linkClass, 'flex items-center gap-1 text-15')}><Icon name="left" size={16} />Today</Link>
        <Brand className="text-15" />
      </div>
      <h1 className="text-32 font-extrabold tracking-[-0.035em]">Use with laptop</h1>
      <Devices />
      <p className="text-15 text-muted">Read the script on your laptop's big screen. Talk through this phone. Starter and Pro only.</p>
      <ol className="flex list-none flex-col rounded-2xl bg-surface">
        {['Open dialer.app on your laptop', 'Choose Use my phone to talk', 'Scan the code it shows'].map((t, i) => (
          <li key={t} className="flex items-center gap-3 border-t border-line px-4 py-3.5 text-15 font-semibold first:border-t-0">
            <span className="flex size-6 flex-none items-center justify-center rounded-full bg-night text-12 font-bold text-white">{i + 1}</span>{t}
          </li>
        ))}
      </ol>
      <span className="flex-1" />
      {typing ? (
        <form className="flex flex-col gap-2.5" onSubmit={e => { e.preventDefault(); setStep('mic'); }}>
          <Input aria-label="Code from your laptop" placeholder="6-letter code from your laptop" autoCapitalize="characters" className="h-12 text-center font-mono text-18 tracking-[.2em]" />
          <Button type="submit" variant="primary" size="xl" block>Connect</Button>
        </form>
      ) : (
        <Button variant="primary" size="xl" block onClick={() => setStep('scan')}><Icon name="qr" />Scan code</Button>
      )}
      <LinkButton className="self-center text-15" onClick={() => setTyping(t => !t)}>{typing ? 'Scan the code instead' : 'Type the code instead'}</LinkButton>
    </Screen>
  );
}
