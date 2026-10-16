'use client';

import { QrCode } from './qrcode';
import type { GeneratedVoucher } from '@/lib/types';

/**
 * Print-friendly voucher sheets. Rendered inside a `.print-area` container
 * (hidden on screen, only visible in `@media print` — see globals.css).
 */

export interface VoucherPrintData {
  vouchers: GeneratedVoucher[];
  routerName: string;
  batchComment?: string;
  profileName?: string;
  /** When set, the QR encodes a one-tap login URL; otherwise username/password text. */
  loginUrl?: string;
}

function qrPayload(v: GeneratedVoucher, loginUrl?: string): string {
  if (loginUrl) {
    const sep = loginUrl.includes('?') ? '&' : '?';
    return `${loginUrl}${sep}username=${encodeURIComponent(v.name)}&password=${encodeURIComponent(v.password)}`;
  }
  return `hotspot-login\nuser: ${v.name}\npassword: ${v.password}`;
}

function VoucherCard({ v, loginUrl, profileName }: { v: GeneratedVoucher; loginUrl?: string; profileName?: string }) {
  return (
    <div className="voucher-card flex items-center gap-4 rounded-xl border-2 border-slate-900 bg-white p-4 text-slate-900">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">username / user</p>
        <p className="truncate font-mono text-xl font-bold" dir="ltr">
          {v.name}
        </p>
        <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">password</p>
        <p className="truncate font-mono text-xl font-bold" dir="ltr">
          {v.password}
        </p>
        {profileName && <p className="mt-2 text-[11px] text-slate-500">{profileName}</p>}
      </div>
      <QrCode text={qrPayload(v, loginUrl)} size={96} />
    </div>
  );
}

export function VoucherPrintSheet({ data }: { data: VoucherPrintData }) {
  const today = new Date().toLocaleDateString();
  return (
    <div className="print-area hidden bg-white text-slate-900 print:block">
      <div className="p-6">
        <div className="mb-4 flex items-baseline justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <h1 className="text-xl font-bold">Hotspot vouchers — {data.routerName}</h1>
            {data.batchComment && (
              <p className="mt-1 font-mono text-xs text-slate-600" dir="ltr">
                {data.batchComment}
              </p>
            )}
          </div>
          <p className="text-xs text-slate-600">
            {today} · {data.vouchers.length}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {data.vouchers.map((v) => (
            <VoucherCard key={v.name} v={v} loginUrl={data.loginUrl} profileName={data.profileName} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Compact text-only batch sheet (no QR) — more codes per printed page. */
export function VoucherTextPrintSheet({ data }: { data: VoucherPrintData }) {
  const today = new Date().toLocaleDateString();
  return (
    <div className="print-area hidden bg-white text-slate-900 print:block">
      <div className="p-6">
        <div className="mb-4 flex items-baseline justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <h1 className="text-xl font-bold">Hotspot vouchers — {data.routerName}</h1>
            {data.batchComment && (
              <p className="mt-1 font-mono text-xs text-slate-600" dir="ltr">
                {data.batchComment}
              </p>
            )}
          </div>
          <p className="text-xs text-slate-600">
            {today} · {data.vouchers.length}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-900 text-start">
              <th className="py-1 text-start font-semibold">#</th>
              <th className="py-1 text-start font-semibold">Username</th>
              <th className="py-1 text-start font-semibold">Password</th>
            </tr>
          </thead>
          <tbody>
            {data.vouchers.map((v, i) => (
              <tr key={v.name} className="border-b border-slate-200">
                <td className="py-1 tabular-nums text-slate-500">{i + 1}</td>
                <td className="py-1 font-mono font-bold" dir="ltr">
                  {v.name}
                </td>
                <td className="py-1 font-mono" dir="ltr">
                  {v.password}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Single-user print card (password unknown to the panel — left blank to fill in). */
export function SingleUserPrintSheet({
  username,
  profileName,
  routerName,
}: {
  username: string;
  profileName?: string | null;
  routerName: string;
}) {
  return (
    <div className="print-area hidden bg-white text-slate-900 print:block">
      <div className="mx-auto max-w-md p-6">
        <h1 className="mb-4 border-b-2 border-slate-900 pb-3 text-xl font-bold">Hotspot user — {routerName}</h1>
        <div className="rounded-xl border-2 border-slate-900 bg-white p-6 text-slate-900">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">username</p>
          <p className="font-mono text-2xl font-bold" dir="ltr">
            {username}
          </p>
          <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-slate-500">password</p>
          <p className="font-mono text-2xl text-slate-400" dir="ltr">
            ………………
          </p>
          {profileName && <p className="mt-4 text-xs text-slate-500">{profileName}</p>}
          <p className="mt-4 text-[11px] text-slate-400">Password is set on the router — ask the operator.</p>
        </div>
      </div>
    </div>
  );
}
