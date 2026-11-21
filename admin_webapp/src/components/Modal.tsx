'use client';

export default function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`my-6 w-full rounded-lg bg-white shadow-xl ${wide ? 'max-w-5xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="text-slate-500 hover:text-slate-800" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
