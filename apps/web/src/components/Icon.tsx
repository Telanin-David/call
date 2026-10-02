export const ICON_NAMES = [
  'i-ban', 'i-building', 'i-cal', 'i-call', 'i-callback', 'i-check', 'i-clock', 'i-down', 'i-file', 'i-gear',
  'i-globe', 'i-hangup', 'i-headset', 'i-history', 'i-id', 'i-laptop', 'i-left', 'i-link', 'i-list', 'i-lock',
  'i-mail', 'i-mic', 'i-micoff', 'i-missed', 'i-more', 'i-note', 'i-panel', 'i-pause', 'i-phone', 'i-pin',
  'i-play', 'i-qr', 'i-right', 'i-shield', 'i-skip', 'i-spark', 'i-speaker', 'i-sun', 'i-up', 'i-upload',
  'i-users', 'i-vol', 'i-wallet', 'i-wifioff', 'i-wrong', 'i-x',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

interface IconProps {
  name: IconName;
  size?: number;
}

export default function Icon({ name, size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} className="dl-icon" aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}
