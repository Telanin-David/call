import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { IconSprite } from '@dialer/ui';
import '@dialer/ui/theme.css';

import { routes } from './routes';
import { PlanProvider, DevPlanSwitcher } from './lib/plan';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30, retry: 1 },
  },
});

const router = createBrowserRouter(routes);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <IconSprite />
    <QueryClientProvider client={queryClient}>
      <PlanProvider>
        <Suspense fallback={null}>
          <RouterProvider router={router} />
        </Suspense>
        {import.meta.env.DEV && <DevPlanSwitcher />}
      </PlanProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
