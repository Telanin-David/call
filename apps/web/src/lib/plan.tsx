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
    <details className="dl-dev">
      <summary>Dev · {PLAN_LABEL[plan]}</summary>
      <div className="dl-seg">
        {(Object.keys(PLAN_LABEL) as Plan[]).map(p => (
          <button key={p} type="button" aria-pressed={plan === p} onClick={() => setPlan(p)}>{PLAN_LABEL[p]}</button>
        ))}
      </div>
    </details>
  );
}
