import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, DarkCard, DarkEyebrow, Icon, Input, LinkButton, Note, PageHeader, PriceRow, Segmented, cn, linkClass, useToast } from '@dialer/ui';
import { BackLink, TwoCol } from '@/components/Page';
import { api, errorText } from '@/lib/api';
import { isLive } from '@/lib/backend';
import { useMe, useRefreshMoney } from '@/lib/account';
import { formatUsd, usd } from '@/lib/money';
import { numberKeys, prettyNumber, useNumberSearch, type RentedNumber } from '@/lib/numbers';
import { NUMBER_MONTHLY } from '@/lib/pricing';

type Country = 'us' | 'ca';

const AREAS: Record<Country, { code: string; city: string }> = {
  us: { code: '646', city: 'New York, NY' },
  ca: { code: '416', city: 'Toronto, ON' },
};

const COUNTRIES = [{ value: 'us', label: 'United States' }, { value: 'ca', label: 'Canada' }] as const;
const SUFFIXES = ['0142', '0187', '0123', '0199', '0176', '0158'];
const MORE_SUFFIXES = ['0168', '0177', '0185', '0193'];
const BALANCE_NOW = usd(10);
const SHOWN = 6;

export default function GetNumber() {
  const live = isLive();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromSettings = params.get('from') === 'settings';
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = useRefreshMoney();
  const me = useMe();
  const [country, setCountry] = useState<Country>('us');
  const [area, setArea] = useState(AREAS.us.code);
  const [picked, setPicked] = useState(0);
  const [more, setMore] = useState(false);
  const search = useNumberSearch(country === 'us' ? 'US' : 'CA', area);

  const demoCity = area === AREAS[country].code ? AREAS[country].city : '';
  const found = live
    ? (search.data?.numbers ?? []).map(n => ({ number: n.number, label: prettyNumber(n.number), city: n.city }))
    : (more ? [...SUFFIXES, ...MORE_SUFFIXES] : SUFFIXES).map(s => ({ number: `+1${area}555${s}`, label: `+1 (${area}) 555-${s}`, city: demoCity }));
  const numbers = live && !more ? found.slice(0, SHOWN) : found;
  const chosen = numbers[picked] ?? numbers[0];
  const city = chosen?.city ?? demoCity;
  const price = live ? search.data?.monthly_price_microdollars ?? NUMBER_MONTHLY : NUMBER_MONTHLY;
  const balance = live ? me.data?.balance_microdollars ?? 0 : BALANCE_NOW;
  const short = Math.max(0, price - balance);

  // A new search starts at its first number.
  useEffect(() => { setPicked(0); }, [search.data]);

  const rent = useMutation({
    mutationFn: () => api.post<RentedNumber>('/numbers', { number: chosen?.number, city: chosen?.city ?? '', country: country.toUpperCase() }),
    onSuccess: async n => {
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: numberKeys.mine })]);
      toast(`${prettyNumber(n.number)} is yours`);
      navigate(fromSettings ? '/settings?tab=numbers' : '/leads/upload?from=setup');
    },
    onError: () => qc.invalidateQueries({ queryKey: numberKeys.search(country.toUpperCase(), area) }),
  });

  function switchCountry(c: Country) {
    setCountry(c);
    setArea(AREAS[c].code);
    setPicked(0);
    setMore(false);
    rent.reset();
  }

  const searching = live && area.length === 3 && search.isFetching && !search.data;
  const noneHere = live && area.length === 3 && search.isSuccess && found.length === 0;
  const canMore = live ? found.length > SHOWN : true;

  return (
    <TwoCol side={340}>
      <div className="flex flex-col gap-[18px]">
        <PageHeader back={fromSettings ? <BackLink to="/settings?tab=numbers">Settings</BackLink> : <BackLink to="/setup">Setup · step 4 of 6</BackLink>}
          title="Get your number"
          lede="Pick an area code close to your leads. People are more likely to pick up a local number." />
        <Segmented label="Country" options={COUNTRIES} value={country} onChange={switchCountry} className="w-full sm:w-[280px]" />
        <div className="relative">
          <Icon name="pin" className="absolute left-3.5 top-[15px] text-faint" />
          <Input aria-label="Area code" inputMode="numeric" value={area} className="h-12 pl-[42px] text-16"
            onChange={e => { setArea(e.target.value.replace(/\D/g, '').slice(0, 3)); setPicked(0); setMore(false); rent.reset(); }} />
          {city && <small className="absolute right-3.5 top-3.5 text-13 text-muted">{city}</small>}
        </div>
        {area.length < 3 ? (
          <p className="text-13 text-muted">Type a 3-digit area code.</p>
        ) : search.isError ? (
          <Note tone="danger" className="text-14"><Icon name="wrong" size={16} /><span role="alert">{errorText(search.error)}</span></Note>
        ) : searching ? (
          <p className="text-14 text-muted">Looking for numbers in {area}…</p>
        ) : noneHere ? (
          <p className="text-14 text-muted">No numbers free in {area} right now. Try a nearby area code.</p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Available numbers">
            {numbers.map((n, i) => (
              <button key={n.number} type="button" role="radio" aria-checked={picked === i} onClick={() => { setPicked(i); rent.reset(); }}
                className="group flex w-full cursor-pointer items-center gap-3.5 rounded-xl border-0 bg-surface px-4 py-3.5 text-left shadow-[inset_0_0_0_1px_var(--line)] aria-checked:bg-brand-tint aria-checked:shadow-[inset_0_0_0_2px_var(--color-tangerine)]">
                <span className="size-[22px] flex-none rounded-full shadow-[inset_0_0_0_2px_var(--off)] group-aria-checked:bg-tangerine group-aria-checked:shadow-[inset_0_0_0_6px_var(--color-tangerine),inset_0_0_0_9px_#fff]" />
                <span className="min-w-0 flex-1">
                  <b className="text-17 leading-[22px] font-bold tracking-[-0.01em] tabular-nums">{n.label}</b>
                  <small className="block text-13 leading-[22px] text-muted">{n.city ? `${n.city} · Local number` : 'Local number'}</small>
                </span>
                <span className="text-14 font-bold">{formatUsd(price)}<span className="font-medium text-muted"> a month</span></span>
              </button>
            ))}
          </div>
        )}
        {area.length === 3 && !more && canMore && !search.isError && <LinkButton className="self-start text-14" onClick={() => setMore(true)}>Show more numbers</LinkButton>}
      </div>

      <aside className="flex flex-col gap-3.5">
        <DarkCard blobs="number" className="p-6">
          <DarkEyebrow>YOUR NEW NUMBER</DarkEyebrow>
          <div className="mt-2 text-28 font-extrabold tracking-[-0.02em] tabular-nums">{chosen?.label ?? '—'}</div>
          <div className="mt-0.5 text-14 text-zinc-400">{city}</div>
          <div className="mt-[22px] flex flex-col gap-2.5 text-14 text-zinc-300">
            <span className="flex gap-2.5"><Icon name="call" size={17} className="mt-px text-glow" />Leads see this number when you call</span>
            <span className="flex gap-2.5"><Icon name="history" size={17} className="mt-px text-glow" />They can call you back on it</span>
          </div>
        </DarkCard>
        <div className="flex flex-col gap-1 rounded-3xl border border-line bg-surface p-5">
          <PriceRow label="Number, monthly" value={formatUsd(price)} muted />
          <PriceRow label="Balance now" value={formatUsd(balance)} muted />
          <PriceRow label="Balance after" value={formatUsd(balance - price)} total className={cn('mt-1', short > 0 && 'text-danger-ink')} />
          {live && short > 0 && (
            <p className="mt-2 text-14 text-danger-ink" role="alert">
              Add {formatUsd(short)} to your balance first. <Link to="/wallet" className={linkClass}>Top up</Link>
            </p>
          )}
          {rent.isError && <p className="mt-2 text-14 text-danger-ink" role="alert">{errorText(rent.error)}</p>}
          <Button variant="primary" size="lg" block className="mt-3" disabled={live && (!chosen || short > 0 || rent.isPending)}
            onClick={() => (live ? rent.mutate() : navigate('/leads/upload?from=setup'))}>
            {rent.isPending ? 'Renting…' : `Rent for ${formatUsd(price)}`}
          </Button>
          <span className="mt-2 text-12 leading-[17px] text-muted">Renews every month from your balance on the same date. You can rent as many numbers as you need, {formatUsd(price)} each. Cancel any one in Settings. You keep it until the end of the month you paid for.</span>
        </div>
      </aside>
    </TwoCol>
  );
}
