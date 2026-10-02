export default function CodeBoxes({ digits, size }: { digits: string; size: 'md' | 'lg' }) {
  return (
    <div className={`dl-codein dl-codein--${size}`} aria-label="6-digit code">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={i === digits.length ? 'is-active' : undefined}>{digits[i] ?? ''}</span>
      ))}
    </div>
  );
}
