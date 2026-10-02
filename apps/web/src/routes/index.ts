import type { RouteObject } from 'react-router-dom';
import { lazy } from 'react';
import AppLayout, { type ShellHandle } from '@/layouts/AppLayout';
import { usd } from '@/lib/money';

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

const h = (handle: ShellHandle) => handle;

export const routes: RouteObject[] = [
  { path: '/signin', Component: Signin },
  { path: '/signup', Component: Signup },
  { path: '/confirm', Component: Confirm },
  { path: '/forgot', Component: Forgot },
  {
    Component: AppLayout,
    children: [
      { path: '/setup', Component: Setup, handle: h({ onboarding: true, balance: 0 }) },
      { path: '/numbers', Component: GetNumber, handle: h({ onboarding: true, balance: usd(10) }) },
      { path: '/', Component: Today, handle: h({ section: 'today' }) },
      { path: '/call/:leadId?', Component: Calling, handle: h({ section: 'calling', device: true }) },
      { path: '/followups', Component: Followups, handle: h({ section: 'followups' }) },
      { path: '/leads', Component: Leads, handle: h({ section: 'leads' }) },
      { path: '/leads/upload', Component: UploadLeads, handle: h({ section: 'leads', balance: usd(8, 50) }) },
      { path: '/scripts', Component: Scripts, handle: h({ section: 'leads' }) },
      { path: '/history', Component: History, handle: h({ section: 'history' }) },
      { path: '/wallet', Component: Wallet, handle: h({}) },
      { path: '/settings', Component: Settings, handle: h({}) },
      { path: '/plans', Component: ComparePlans, handle: h({ white: true }) },
    ],
  },
];
