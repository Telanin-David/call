import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Chip, DarkCard, DarkEyebrow, Icon, LinkButton, PageHeader, Tile, cn, type IconName } from '@dialer/ui';
import { BackLink, Page } from '@/components/Page';
import { ME } from '@/lib/fake';

const GAINS: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'call', title: '500 dials a day on Starter', sub: 'Up from 120' },
  { icon: 'shield', title: 'No new-account limits', sub: 'On any plan, for good' },
  { icon: 'globe', title: 'Calls outside the US and Canada', sub: 'No small daily cap' },
  { icon: 'users', title: 'Multi-dial on Pro', sub: 'After we approve it' },
];

const IDS = ['National ID or NIN slip', 'International passport', "Driver's licence", 'Ghana Card', 'Kenya National ID'] as const;

function Step({ n, now, title, sub, children }: { n: number; now?: boolean; title: string; sub: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className={cn('flex size-[30px] flex-none items-center justify-center rounded-full text-14 font-bold',
        now ? 'bg-tangerine text-night' : 'bg-sunk text-muted')}>{n}</span>
      <div className="min-w-0 flex-1">
        <b className="block text-17">{title}</b>
        <p className="text-14 text-muted">{sub}</p>
        {children}
      </div>
    </li>
  );
}

type Stage = 'pick' | 'photo' | 'face' | 'done';

function CameraLayer({ step, onBack, children }: { step: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-night text-white">
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-5 px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex items-center">
          <LinkButton className="flex items-center gap-1 text-15 text-glow" onClick={onBack}><Icon name="left" size={16} />Back</LinkButton>
          <b className="flex-1 pr-14 text-center text-15">{step}</b>
        </div>
        {children}
      </div>
    </div>
  );
}

function PhotoStep({ id, onBack, onDone }: { id: string; onBack: () => void; onDone: () => void }) {
  const [taken, setTaken] = useState(false);
  return (
    <CameraLayer step="Step 2 of 3" onBack={onBack}>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className={cn('relative flex aspect-[1.586] w-full items-center justify-center rounded-2xl border-[3px]', taken ? 'border-success bg-white/10' : 'border-dashed border-sun')}>
          {taken
            ? <span className="flex flex-col items-center gap-2 text-14 text-zinc-300"><Icon name="id" size={40} />Photo of your {id.toLowerCase()}</span>
            : <span className="text-14 text-zinc-400">Fit the front of your ID in this frame</span>}
        </div>
        <b className="text-22">{taken ? 'Can you read every word?' : 'Take a photo of it'}</b>
        <p className="text-14 text-zinc-400">{taken ? 'If any part is blurry or has glare, take it again.' : 'Front only. No glare, all four corners in the photo.'}</p>
      </div>
      {taken ? (
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="xl" block onClick={onDone}>Use this photo</Button>
          <Button variant="glass" size="lg" block onClick={() => setTaken(false)}>Take it again</Button>
        </div>
      ) : (
        <Button variant="primary" size="xl" block onClick={() => setTaken(true)}><Icon name="id" />Take photo</Button>
      )}
    </CameraLayer>
  );
}

function FaceStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setProgress(p => Math.min(100, p + 10)), 400);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (progress >= 100) onDone(); }, [progress, onDone]);
  return (
    <CameraLayer step="Step 3 of 3" onBack={onBack}>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="relative flex h-[300px] w-[230px] items-center justify-center rounded-[50%] border-4 border-success bg-white/5">
          <span className="absolute -top-3 rounded-full bg-success px-2.5 py-0.5 text-12 font-bold text-white">Hold still</span>
          <span aria-hidden="true" className="size-28 rounded-full bg-white/10" />
        </div>
        <b className="text-22">Look at the camera</b>
        <p className="text-14 text-zinc-400">Then slowly turn your head left and right. Good light, no hat or glasses.</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Face check" aria-valuenow={progress} aria-valuemax={100}>
        <span className="block h-full rounded-full bg-tangerine transition-[width]" style={{ width: `${progress}%` }} />
      </div>
    </CameraLayer>
  );
}

export default function VerifyId() {
  const [id, setId] = useState<(typeof IDS)[number]>(IDS[0]);
  const [onLaptop, setOnLaptop] = useState(false);
  const [stage, setStage] = useState<Stage>('pick');
  const navigate = useNavigate();

  if (stage === 'photo') return <PhotoStep id={id} onBack={() => setStage('pick')} onDone={() => setStage('face')} />;
  if (stage === 'face') return <FaceStep onBack={() => setStage('photo')} onDone={() => setStage('done')} />;
  if (stage === 'done') {
    return (
      <Page width={1040}>
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <Tile tone="mint" size={40}><Icon name="check" size={20} /></Tile>
          <h1 className="text-28 font-extrabold tracking-[-0.03em]">We're checking your ID</h1>
          <p className="max-w-[460px] text-15 text-muted">Usually under 10 minutes. We'll email you, and your new-account limits come off as soon as it's approved.</p>
          <Button variant="primary" size="lg" className="mt-2" onClick={() => navigate('/settings')}>Back to settings</Button>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Verify your ID" lede="Takes about 3 minutes. We check that you're a real person and that your name matches your account."
        back={<BackLink to="/settings">Settings</BackLink>} />

      <div className="grid items-start gap-3.5 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-5">
        <DarkCard blobs="number" as="aside" aria-label="What you get" className="p-6">
          <DarkEyebrow>WHAT YOU GET</DarkEyebrow>
          <ul className="mt-3 flex list-none flex-col">
            {GAINS.map(g => (
              <li key={g.title} className="flex items-center gap-3.5 border-t border-white/10 py-3.5">
                <span className="flex size-[34px] flex-none items-center justify-center rounded-md bg-white/8 text-glow"><Icon name={g.icon} size={17} /></span>
                <span><b className="block text-15 font-bold">{g.title}</b><span className="text-13 text-zinc-400">{g.sub}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-13 text-zinc-400">
            The name on your ID must be <b className="text-white">{ME.name}</b>. Your photos go to our ID check partner and are not shown to anyone else.
          </p>
        </DarkCard>

        <section aria-label="Steps" className="rounded-3xl border border-line bg-surface p-5 sm:p-[26px]">
          <ol className="flex list-none flex-col gap-6">
            <Step n={1} now title="Pick your ID" sub="It must be in date and show your photo.">
              <div className="mt-3.5 flex flex-wrap gap-2" role="group" aria-label="ID type">
                {IDS.map(t => (
                  <Chip key={t} pressed={id === t} onClick={() => setId(t)} className="h-10 px-3.5">{t}</Chip>
                ))}
              </div>
            </Step>
            <Step n={2} title="Take a photo of it" sub="Front only. No glare, all four corners in the photo." />
            <Step n={3} title="Face check" sub="A short video of your face, so we know the ID is yours.">
              <div className="mt-3.5 flex flex-col gap-4 rounded-2xl bg-sunk p-4 max-md:hidden sm:flex-row sm:items-center">
                {onLaptop ? (
                  <div className="flex flex-1 flex-col gap-1">
                    <b className="text-16">Use this laptop's camera</b>
                    <p className="text-14 text-muted">We'll ask your browser for the camera when you start. Hold the {id.toLowerCase()} close to the lens.</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button variant="primary" onClick={() => setStage('photo')}>Start on this laptop</Button>
                      <LinkButton className="text-14" onClick={() => setOnLaptop(false)}>Use my phone instead</LinkButton>
                    </div>
                  </div>
                ) : (
                  <>
                    <img src="/qr-demo.svg" alt="Code to open the ID check on your phone" className="size-[120px] flex-none rounded-xl bg-white p-2" />
                    <div className="flex flex-col gap-1">
                      <b className="text-16">Do steps 2 and 3 on your phone</b>
                      <p className="text-14 text-muted">Scan this with your phone camera. Its camera takes a sharper photo than a laptop webcam.</p>
                      <LinkButton className="self-start text-14" onClick={() => setOnLaptop(true)}>Use this laptop instead</LinkButton>
                    </div>
                  </>
                )}
              </div>
            </Step>
          </ol>
          <Button variant="primary" size="xl" block className="mt-6 md:hidden" onClick={() => setStage('photo')}>Take a photo of it</Button>
        </section>
      </div>
    </Page>
  );
}
