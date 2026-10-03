import { Outlet } from 'react-router-dom';
import { ToastProvider } from '@dialer/ui';
import { DevPlanSwitcher } from '@/lib/plan';
import { DEV_TOOLS } from '@/lib/devtools';

/** Wraps every route so dev tools and toasts can use the router. */
export default function Root() {
  return (
    <ToastProvider>
      <Outlet />
      {DEV_TOOLS && <DevPlanSwitcher />}
    </ToastProvider>
  );
}
