import type { RouteObject } from 'react-router-dom';
import { lazy } from 'react';

const Signin = lazy(() => import('./auth/Signin'));
const Signup = lazy(() => import('./auth/Signup'));
const Confirm = lazy(() => import('./auth/Confirm'));
const Forgot = lazy(() => import('./auth/Forgot'));
const Setup = lazy(() => import('./auth/Setup'));

const Today = lazy(() => import('./today/Today'));
const Calling = lazy(() => import('./calling/Calling'));
const Leads = lazy(() => import('./leads/Leads'));
const UploadLeads = lazy(() => import('./leads/UploadLeads'));
const Scripts = lazy(() => import('./scripts/Scripts'));
const Followups = lazy(() => import('./followups/Followups'));
const History = lazy(() => import('./history/History'));
const Wallet = lazy(() => import('./wallet/Wallet'));
const GetNumber = lazy(() => import('./numbers/GetNumber'));
const Settings = lazy(() => import('./settings/Settings'));
const ComparePlans = lazy(() => import('./plans/ComparePlans'));

export const routes: RouteObject[] = [
  { path: '/signin', Component: Signin },
  { path: '/signup', Component: Signup },
  { path: '/confirm', Component: Confirm },
  { path: '/forgot', Component: Forgot },
  { path: '/setup', Component: Setup },

  { path: '/', Component: Today },
  { path: '/call/:leadId', Component: Calling },
  { path: '/leads', Component: Leads },
  { path: '/leads/upload', Component: UploadLeads },
  { path: '/scripts', Component: Scripts },
  { path: '/followups', Component: Followups },
  { path: '/history', Component: History },
  { path: '/wallet', Component: Wallet },
  { path: '/numbers', Component: GetNumber },
  { path: '/settings', Component: Settings },
  { path: '/plans', Component: ComparePlans },
];
