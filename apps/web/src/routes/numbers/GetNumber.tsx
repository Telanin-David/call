import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, DarkCard, DarkEyebrow, Icon, Input, LinkButton, PageHeader, PriceRow, Segmented } from '@dialer/ui';
import { BackLink, TwoCol } from '@/components/Page';
import { formatUsd, usd } from '@/lib/money';
import { NUMBER_MONTHLY } from '@/lib/pricing';

type Country = 'us' | 'ca';

const AREAS: Record<Country, { code: string; city: string }> = {
  us: { code: '646', city: 'New York, NY' },
  ca: { code: '416', city: 'Toronto, ON' },
};

const COUNTRIES = [{ value: 'us', label: 'United States' }, { value: 'ca', label: 'Canada' }] as const;
const SUFFIXES = ['0142', '0187', '0123', '0199', '0176', '0158'];
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
    <TwoCol side={340}>
      <div className="flex flex-col gap-[18px]">
        <PageHeader back={<BackLink to="/setup">Setup · step 4 of 6</BackLink>} title="Get your number"
          lede="Pick an area code close to your leads. People are more likely to pick up a local number." />
        <Segmented label="Country" options={COUNTRIES} value={country} onChange={switchCountry} className="w-[280px]" />
        <div className="relative">
          <Icon name="pin" className="absolute left-3.5 top-[15px] text-faint" />
          <Input aria-label="Area code" inputMode="numeric" value={area} className="h-12 pl-[42px] text-16"
            onChange={e => setArea(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          {city && <small className="absolute right-3.5 top-3.5 text-13 text-muted">{city}</small>}
        </div>
        {area.length === 3 ? (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Available numbers">
            {numbers.map((n, i) => (
              <button key={n} type="button" role="radio" aria-checked={picked === i} onClick={() => setPicked(i)}
                className="group flex w-full cursor-pointer items-center gap-3.5 rounded-xl border-0 bg-surface px-4 py-3.5 text-left shadow-[inset_0_0_0_1px_var(--line)] aria-checked:bg-brand-tint aria-checked:shadow-[inset_0_0_0_2px_var(--color-tangerine)]">
                <span className="size-[22px] flex-none rounded-full shadow-[inset_0_0_0_2px_var(--off)] group-aria-checked:bg-tangerine group-aria-checked:shadow-[inset_0_0_0_6px_var(--color-tangerine),inset_0_0_0_9px_#fff]" />
                <span className="flex-1">
                  <b className="text-17 leading-[22px] font-bold tracking-[-0.01em] tabular-nums">{n}</b>
                  <small className="block text-13 leading-[22px] text-muted">{city ? `${city} · Local number` : 'Local number'}</small>
                </span>
                <span className="text-14 font-bold">{formatUsd(NUMBER_MONTHLY)}<span className="font-medium text-muted"> a month</span></span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-13 text-muted">Type a 3-digit area code.</p>
        )}
        <LinkButton className="self-start text-14">Show more numbers</LinkButton>
      </div>

      <aside className="flex flex-col gap-3.5">
        <DarkCard blobs="number" className="p-6">
          <DarkEyebrow>YOUR NEW NUMBER</DarkEyebrow>
          <div className="mt-2 text-28 font-extrabold tracking-[-0.02em] tabular-nums">{chosen}</div>
          <div className="mt-0.5 text-14 text-zinc-400">{city}</div>
          <div className="mt-[22px] flex flex-col gap-2.5 text-14 text-zinc-300">
            <span className="flex gap-2.5"><Icon name="call" size={17} className="mt-px text-glow" />Leads see this number when you call</span>
            <span className="flex gap-2.5"><Icon name="history" size={17} className="mt-px text-glow" />They can call you back on it</span>
          </div>
        </DarkCard>
        <div className="flex flex-col gap-1 rounded-3xl border border-line bg-surface p-5">
          <PriceRow label="Number, monthly" value={formatUsd(NUMBER_MONTHLY)} muted />
          <PriceRow label="Balance now" value={formatUsd(BALANCE_NOW)} muted />
          <PriceRow label="Balance after" value={formatUsd(BALANCE_NOW - NUMBER_MONTHLY)} total className="mt-1" />
          <Button variant="primary" size="lg" block className="mt-3" onClick={() => navigate('/leads/upload?from=setup')}>Rent for {formatUsd(NUMBER_MONTHLY)}</Button>
          <span className="mt-2 text-12 leading-[17px] text-muted">Renews every month from your balance on the same date. You can rent as many numbers as you need, $1.50 each. Cancel any one in Numbers. You keep it until the end of the month you paid for.</span>
        </div>
      </aside>
    </TwoCol>
  );
}
