import { Button, Icon, PageHeader, Tile, type IconName, type TileTone } from '@dialer/ui';
import { BackLink, Page } from '@/components/Page';
import { useMe } from '@/lib/account';
import { isLive } from '@/lib/backend';

const RULES: { icon: IconName; tone: TileTone; title: string; body: string }[] = [
  { icon: 'users', tone: 'brand', title: 'One account per person', body: 'Use your real name. The name on your card must match it. Shared or second accounts are closed.' },
  { icon: 'shield', tone: 'mint', title: 'New accounts have limits', body: 'Until you verify your ID, Free accounts get fewer dials each month, down to 10 a day from month 3. Starter gets 120. Verifying removes these limits.' },
  { icon: 'call', tone: 'lemon', title: 'Each number, 3 tries', body: "You can call the same number 3 times. After that it is blocked for you, so leads aren't pestered." },
  { icon: 'ban', tone: 'red', title: 'Some numbers are never called', body: 'Premium-rate numbers and anyone on the do-not-call list. We skip them and you are never charged.' },
  { icon: 'clock', tone: 'grey', title: 'Call at decent hours', body: "Only call between 8 am and 9 pm in the lead's time. The dial screen shows their time so you can check." },
  { icon: 'globe', tone: 'brand', title: 'Calls outside the US and Canada', body: 'Every country has its own price. New accounts can spend up to $3 a day on these until ID is verified.' },
  { icon: 'wallet', tone: 'mint', title: 'Everything is prepaid', body: 'Calls, numbers and plans come out of your balance. No balance, no calls. You are never billed later.' },
  { icon: 'lock', tone: 'grey', title: 'Breaking the rules', body: 'We may pause or close the account. Serious cases, like calling the do-not-call list on purpose, are closed straight away.' },
];

function agreedOn(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Rules() {
  const me = useMe();
  const signedIn = !isLive() || Boolean(me.data);
  const agreed = !isLive() ? '1 Oct 2026' : me.data?.rules_accepted_at ? agreedOn(me.data.rules_accepted_at) : null;
  return (
    <Page>
      <PageHeader title="The rules" lede="Short and fair. They keep your number working and keep leads willing to pick up."
        back={<BackLink to={signedIn ? '/settings' : '/signup'}>Back</BackLink>} />

      <div className="grid gap-3.5 md:grid-cols-2">
        {RULES.map(r => (
          <section key={r.title} className="flex gap-3.5 rounded-3xl border border-line bg-surface p-5">
            <Tile tone={r.tone}><Icon name={r.icon} size={19} /></Tile>
            <div>
              <h2 className="text-17 font-bold">{r.title}</h2>
              <p className="mt-1 text-14 text-muted">{r.body}</p>
            </div>
          </section>
        ))}
      </div>

      <div className="flex flex-col items-start gap-3.5 rounded-3xl bg-night px-[22px] py-5 text-15 text-white sm:flex-row sm:items-center">
        <p className="flex-1">
          {agreed ? <>You agreed to these on <b>{agreed}</b>. </> : 'You agree to these when you create your account. '}
          We&apos;ll tell you before any rule changes.
        </p>
        <Button variant="lemon" onClick={() => window.print()}>Download as PDF</Button>
      </div>
    </Page>
  );
}
