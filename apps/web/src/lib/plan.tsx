import { createContext, useContext, useState, type ReactNode } from 'react';

export type Plan = 'free' | 'starter' | 'pro';

export const PLAN_LABEL: Record<Plan, string> = { free: 'Free', starter: 'Starter', pro: 'Pro' };

interface PlanCtx {
  plan: Plan;
  setPlan: (p: Plan) => void;
}

const Ctx = createContext<PlanCtx>({ plan: 'starter', setPlan: () => {} });

export function PlanProvider({ children, initial = 'starter' }: { children: ReactNode; initial?: Plan }) {
  const [plan, setPlan] = useState<Plan>(initial);
  return <Ctx.Provider value={{ plan, setPlan }}>{children}</Ctx.Provider>;
}

export function usePlan() {
  return useContext(Ctx);
}

export function DevPlanSwitcher() {
  const { plan, setPlan } = usePlan();
  return (
    <details className="group fixed left-1/2 top-3.5 z-50 -translate-x-1/2 text-12 font-semibold max-lg:left-auto max-lg:right-2 max-lg:top-[calc(4rem+env(safe-area-inset-top))] max-lg:translate-x-0 max-lg:opacity-90">
      <summary className="cursor-pointer list-none rounded-full bg-night px-2.5 py-1.5 text-center text-white group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
        Dev · {PLAN_LABEL[plan]}
      </summary>
      <div className="flex gap-0.5 rounded-b-md bg-night p-[3px] max-lg:absolute max-lg:right-0 max-lg:top-full max-lg:rounded-md">
        {(Object.keys(PLAN_LABEL) as Plan[]).map(p => (
          <button key={p} type="button" aria-pressed={plan === p} onClick={() => setPlan(p)}
            className="h-7 cursor-pointer rounded-[7px] border-0 bg-transparent px-3 text-12 text-zinc-300 aria-pressed:bg-tangerine aria-pressed:text-night">
            {PLAN_LABEL[p]}
          </button>
        ))}
      </div>
    </details>
  );
}
