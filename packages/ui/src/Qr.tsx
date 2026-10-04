import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { cn } from './cn';

/**
 * A QR code for `value`, drawn as one SVG path so it stays sharp at any
 * size. Dark modules on a white square with a quiet zone, as phone cameras
 * expect, in light and dark mode alike.
 */
export function QrCode({ value, size = 120, label, className }: { value: string; size?: number; label: string; className?: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { d: path, n: count + 8 };
  }, [value]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges"
      className={cn('flex-none rounded-xl bg-white text-night', className)} data-qr={value}>
      <path d={d} fill="currentColor" />
    </svg>
  );
}
