'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '0.75rem',
  fontSize: '12px',
} as const;

function timeLabel(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CpuMemChart({
  title,
  data,
}: {
  title: string;
  data: Array<{ ts: string; cpuPct: number; memPct: number }>;
}) {
  const rows = data.map((d) => ({ ...d, time: timeLabel(d.ts) }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={[0, 100]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line type="monotone" dataKey="cpuPct" name="CPU %" stroke="#34d399" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="memPct" name="MEM %" stroke="#60a5fa" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function TrafficChart({
  title,
  data,
  formatRate,
}: {
  title: string;
  data: Array<{ ts: string; rxBps: number; txBps: number }>;
  formatRate: (bps: number) => string;
}) {
  const rows = data.map((d) => ({
    time: timeLabel(d.ts),
    rx: Math.round(d.rxBps / 1000),
    tx: Math.round(d.txBps / 1000),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={32} />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v: number) => formatRate(v * 1000)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => formatRate(Number(value ?? 0) * 1000)}
              />
              <Legend />
              <Area type="monotone" dataKey="rx" name="RX" stroke="#34d399" fill="#34d39933" strokeWidth={2} />
              <Area type="monotone" dataKey="tx" name="TX" stroke="#fbbf24" fill="#fbbf2433" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function HotspotActiveChart({
  title,
  data,
}: {
  title: string;
  data: Array<{ ts: string; hotspotActive: number }>;
}) {
  const rows = data.map((d) => ({ time: timeLabel(d.ts), active: d.hotspotActive }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="active" name="active" stroke="#a78bfa" fill="#a78bfa33" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
