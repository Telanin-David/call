import { useEffect, useState } from 'react';
import { Icon, LinkButton, Modal, QrCode, cn } from '@dialer/ui';
import { linkUrl, prettyCode } from '@/lib/pairing';

const STEPS = ['Open your camera and point it at the code', 'Tap Allow for the microphone', 'Play the test sound'] as const;

/** A code from the server, live: shown until the phone joins with it. */
export interface LivePair { code: string; expiresAt: string | null; renew: () => void }

/** Board 02: link a phone to this laptop by QR code or a 6-digit code. */
export function PairDialog({ open, onCancel, onChange, live }: { open: boolean; onCancel: () => void; onChange: () => void; live?: LivePair | null }) {
  const [elapsed, setElapsed] = useState(0);
  const [demoCode, setCode] = useState('482 913');
  const code = live ? prettyCode(live.code) : demoCode;

  useEffect(() => {
    if (!open) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [open]);

  // Demo: fake progress, the phone scans at 2 s, allows the mic at 4 s.
  // Live: waiting for the phone until it joins (the dialog then closes).
  const step = live ? 0 : elapsed < 2 ? 0 : elapsed < 4 ? 1 : 2;
  const left = live
    ? Math.max(0, Math.round(((live.expiresAt ? Date.parse(live.expiresAt) : Date.now()) - Date.now()) / 1000))
    : Math.max(0, 288 - elapsed);

  return (
    <Modal open={open} onClose={onCancel} label="Scan with your phone" bare width="lg" className="grid md:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col items-center gap-3 bg-night px-6 py-7 text-white">
        {live
          ? <QrCode value={linkUrl(live.code)} label="Code to link your phone" size={200} className="p-3" />
          : <img src="/qr-demo.svg" alt="Code to link your phone" className="size-[200px] rounded-2xl bg-white p-3" />}
        <p className="text-13 text-zinc-400">or go to <b className="font-mono text-white">{live ? `${window.location.host}/link` : 'dialer.app/pair'}</b></p>
        <p className="font-mono text-36 font-semibold tracking-[.08em]">{code}</p>
        <p className="flex items-center gap-1.5 text-13 text-zinc-400"><Icon name="clock" size={14} />{left > 0 ? <>Code works for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</> : 'Code expired. Make a new one.'}</p>
      </div>
      <div className="relative flex flex-col gap-4 px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 md:px-7">
        <button type="button" aria-label="Close" onClick={onCancel}
          className="absolute right-4 top-4 flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-sunk hover:text-ink">
          <Icon name="x" size={18} />
        </button>
        <div className="pr-10">
          <h2 className="text-24 font-extrabold tracking-[-0.03em]">Scan with your phone</h2>
          <p className="mt-1 text-14 text-muted">Your phone becomes your mic and speaker for every call. Keep looking at this screen for the script and buttons.</p>
        </div>
        <ol className="flex list-none flex-col gap-3 text-15">
          <li className="flex items-center gap-3">
            <span className="flex size-[26px] flex-none items-center justify-center rounded-full bg-success text-white"><Icon name="check" size={14} /></span>
            <span>You chose <b>use my phone to talk</b> <LinkButton className="text-15" onClick={onChange}>Change</LinkButton></span>
          </li>
          {STEPS.map((t, i) => (
            <li key={t} className={cn('flex items-center gap-3', i > step && 'text-muted')}>
              <span className={cn('flex size-[26px] flex-none items-center justify-center rounded-full text-13 font-bold',
                i < step ? 'bg-success text-white' : i === step ? 'bg-tangerine text-night' : 'bg-sunk text-muted')}>
                {i < step ? <Icon name="check" size={14} /> : i + 2}
              </span>
              {t}
            </li>
          ))}
        </ol>
        <span className="flex-1" />
        <div className="flex items-center gap-2.5 rounded-xl bg-brand-tint px-4 py-3 text-14" role="status">
          <i className="size-2 animate-pulse rounded-full bg-tangerine" />
          <span className="flex-1">{step === 0 ? 'Waiting for your phone' : step === 1 ? 'Phone found. Waiting for the mic' : 'Mic on. Playing a test sound'}</span>
          <LinkButton className="text-14" onClick={() => { if (live) { live.renew(); } else { setCode(c => (c === '482 913' ? '615 204' : '482 913')); } setElapsed(0); }}>New code</LinkButton>
        </div>
      </div>
    </Modal>
  );
}
