import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, cn, linkClass } from '@dialer/ui';

const WIDTH = {
  1040: 'max-w-[1088px]',
  1120: 'max-w-[1168px]',
  1200: 'max-w-[1248px]',
  1240: 'max-w-[1288px]',
} as const;

export function Page({ width = 1120, className, children }: { width?: keyof typeof WIDTH; className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto flex flex-col gap-5 px-6 py-8', WIDTH[width], className)}>{children}</div>;
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn(linkClass, 'mb-3 inline-flex items-center gap-1.5 text-14 font-semibold')}>
      <Icon name="left" size={16} />{children}
    </Link>
  );
}

export function TwoCol({ side, children }: { side: 300 | 340; children: ReactNode }) {
  return (
    <div className={cn('mx-auto grid max-w-[1088px] items-start gap-7 px-6 py-8',
      side === 300 ? 'grid-cols-[minmax(0,1fr)_300px] pt-9' : 'grid-cols-[minmax(0,1fr)_340px]')}>
      {children}
    </div>
  );
}
