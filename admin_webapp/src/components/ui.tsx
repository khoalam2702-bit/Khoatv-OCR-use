import type { LucideIcon } from 'lucide-react';

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'violet' | 'sky';
/** Màu theo ý nghĩa: đỏ = hết / lỗi, vàng = sắp hết / chờ, xanh lá = đã mua / đã thu, xanh dương = dùng thử, xám = huỷ / khoá. */
export const TONE: Record<Tone, { soft: string; badge: string; bar: string; text: string }> = {
  blue: { soft: 'bg-blue-100 text-blue-700', badge: 'bg-blue-50 text-blue-700 ring-blue-200', bar: 'border-l-blue-500', text: 'text-blue-700' },
  sky: { soft: 'bg-sky-100 text-sky-700', badge: 'bg-sky-50 text-sky-800 ring-sky-200', bar: 'border-l-sky-500', text: 'text-sky-700' },
  green: { soft: 'bg-emerald-100 text-emerald-700', badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200', bar: 'border-l-emerald-500', text: 'text-emerald-700' },
  amber: { soft: 'bg-amber-100 text-amber-700', badge: 'bg-amber-50 text-amber-800 ring-amber-300', bar: 'border-l-amber-500', text: 'text-amber-700' },
  red: { soft: 'bg-red-100 text-red-700', badge: 'bg-red-50 text-red-700 ring-red-200', bar: 'border-l-red-500', text: 'text-red-700' },
  violet: { soft: 'bg-violet-100 text-violet-700', badge: 'bg-violet-50 text-violet-700 ring-violet-200', bar: 'border-l-violet-500', text: 'text-violet-700' },
  slate: { soft: 'bg-slate-200 text-slate-600', badge: 'bg-slate-100 text-slate-600 ring-slate-300', bar: 'border-l-slate-300', text: 'text-slate-500' }
};

export function Badge({ tone, icon: Icon, children }: { tone: Tone; icon?: LucideIcon; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone].badge}`}>{Icon && <Icon size={13} aria-hidden />}{children}</span>;
}

export function StatCard({ label, value, hint, icon: Icon, tone }: { label: string; value: React.ReactNode; hint?: string; icon: LucideIcon; tone: Tone }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${TONE[tone].soft}`}><Icon size={20} aria-hidden /></span>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

export function PageTitle({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white"><Icon size={19} aria-hidden /></span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="ml-auto flex gap-2">{children}</div>
    </div>
  );
}
