interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

export default function Icon({ name, size = 18, className = 'ic' }: IconProps) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}
