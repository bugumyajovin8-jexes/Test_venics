/**
 * Dashibodi's revenue bars for the last 7 days. In a file of its own so the
 * chart library (a large piece of code) loads just after the page's figures
 * show, instead of holding up the first screen (lazyPages.ts).
 */
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function RevenueBars({ data, dataKey, name, radius, formatValue }: {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  name?: string;
  radius: [number, number, number, number];
  formatValue: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(value: number) => formatValue(value)}
          cursor={{ fill: '#f3f4f6' }}
        />
        <Bar dataKey={dataKey} name={name} fill="#3b82f6" radius={radius} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
