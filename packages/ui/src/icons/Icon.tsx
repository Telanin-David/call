import sprite from './sprite.svg?raw';
import { cn } from '../cn';

export const ICON_NAMES = [
  'ban', 'building', 'cal', 'call', 'callback', 'check', 'clock', 'down', 'file', 'gear',
  'globe', 'hangup', 'headset', 'history', 'id', 'laptop', 'left', 'link', 'list', 'lock',
  'mail', 'mic', 'micoff', 'missed', 'more', 'note', 'panel', 'pause', 'phone', 'pin',
  'play', 'qr', 'right', 'shield', 'skip', 'spark', 'speaker', 'sun', 'up', 'upload',
  'users', 'vol', 'wallet', 'wifioff', 'wrong', 'x',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={cn('flex-none', className)} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

const symbols = sprite.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

export function IconSprite() {
  return <svg width="0" height="0" className="absolute size-0 overflow-hidden" aria-hidden="true" dangerouslySetInnerHTML={{ __html: symbols }} />;
}
