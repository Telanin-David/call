import { createContext, useContext, useState } from 'react';

export type Plan = 'free' | 'starter' | 'pro';

interface PlanCtx {
  plan: Plan;
  setPlan: (p: Plan) => void;
}

const Ctx = createContext<PlanCtx>({ plan: 'starter', setPlan: () => {} });

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<Plan>('starter');
  return <Ctx.Provider value={{ plan, setPlan }}>{children}</Ctx.Provider>;
}

export function usePlan() {
  return useContext(Ctx);
}

export function DevPlanSwitcher() {
  const { plan, setPlan } = usePlan();
  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, zIndex: 9999,
      background: '#111113', color: '#fff', borderRadius: 12,
      padding: '8px 12px', display: 'flex', gap: 6, fontSize: 12, fontWeight: 600,
    }}>
      <span style={{ opacity: .5, marginRight: 4 }}>Plan:</span>
      {(['free', 'starter', 'pro'] as Plan[]).map(p => (
        <button
          key={p}
          onClick={() => setPlan(p)}
          style={{
            padding: '3px 8px', borderRadius: 6, border: 0, cursor: 'pointer',
            background: plan === p ? '#ff6b1a' : 'rgba(255,255,255,.12)',
            color: plan === p ? '#111113' : '#fff',
            fontWeight: 600, fontSize: 11, textTransform: 'capitalize',
          }}
        >{p}</button>
      ))}
    </div>
  );
}
