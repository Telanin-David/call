import { useState, type ReactNode } from 'react';
import { Chip, DarkCard, DarkEyebrow, Icon, LinkButton, PageHeader, cn, type IconName } from '@dialer/ui';
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

export default function VerifyId() {
  const [id, setId] = useState<(typeof IDS)[number]>(IDS[0]);
  const [onLaptop, setOnLaptop] = useState(false);

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
              <div className="mt-3.5 flex flex-col gap-4 rounded-2xl bg-sunk p-4 sm:flex-row sm:items-center">
                {onLaptop ? (
                  <div className="flex flex-1 flex-col gap-1">
                    <b className="text-16">Use this laptop's camera</b>
                    <p className="text-14 text-muted">We'll ask your browser for the camera when you start. Hold the {id.toLowerCase()} close to the lens.</p>
                    <LinkButton className="self-start text-14" onClick={() => setOnLaptop(false)}>Use my phone instead</LinkButton>
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
        </section>
      </div>
    </Page>
  );
}
