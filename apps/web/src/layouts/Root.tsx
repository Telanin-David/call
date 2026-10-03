import { Outlet } from 'react-router-dom';
import { DevPlanSwitcher } from '@/lib/plan';

/** Wraps every route so dev tools can use the router. */
export default function Root() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && <DevPlanSwitcher />}
    </>
  );
}
