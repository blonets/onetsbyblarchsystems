'use client';

import { useMemo } from 'react';
import { encodeQr } from '@/lib/qrcode';

/**
 * Renders a QR code as crisp SVG using the project's zero-dependency encoder
 * (byte mode, EC-L). `text` longer than version-10 capacity renders a fallback.
 */
export function QrCode({
  text,
  size = 128,
  className,
  title,
}: {
  text: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const matrix = useMemo(() => encodeQr(text), [text]);

  if (!matrix) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        role="img"
        aria-label={title ?? 'QR code too long'}
      >
        <p className="text-[11px] text-red-300">QR: text too long</p>
      </div>
    );
  }

  const n = matrix.size;
  const quiet = 2; // quiet-zone modules
  const total = n + quiet * 2;
  const s = size / total;
  const rects: string[] = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!matrix.rows[r][c]) {
        c++;
        continue;
      }
      let run = 1;
      while (c + run < n && matrix.rows[r][c + run]) run++;
      rects.push(`M${((c + quiet) * s).toFixed(2)} ${((r + quiet) * s).toFixed(2)}h${(run * s).toFixed(2)}v${s.toFixed(2)}H${((c + quiet) * s).toFixed(2)}Z`);
      c += run;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title ?? 'QR code'}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={rects.join(' ')} fill="#000" />
    </svg>
  );
}
