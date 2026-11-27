'use client';
import { useLayoutEffect, useRef } from 'react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  /** Giá trị thô: "1234567" hoặc "1234.5" hoặc "-20"; ô hiển thị 1.234.567 / 1.234,5 */
  value: string;
  onValue: (raw: string) => void;
  decimal?: boolean;
  signed?: boolean;
};

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export function showNumber(raw: string): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!m) return raw;
  return m[1] + group(m[2]) + (m[3] === undefined ? '' : `,${m[3]}`);
}
function toRaw(text: string, decimal: boolean, signed: boolean): string {
  const minus = signed && text.trim().startsWith('-') ? '-' : '';
  const parts = text.split(',');
  const int = parts[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const frac = decimal && parts.length > 1 ? parts.slice(1).join('').replace(/\D/g, '') : null;
  return minus + int + (frac === null ? '' : `.${frac}`);
}

/** Ô nhập số có dấu phân cách hàng nghìn (kiểu Việt Nam: chấm hàng nghìn, phẩy thập phân). */
export default function NumberInput({ value, onValue, decimal = false, signed = false, className = 'input', ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null); // số ký tự không phải dấu chấm đứng trước con trỏ
  const shown = showNumber(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current === null || !el || document.activeElement !== el) return;
    let pos = 0;
    for (let seen = 0; pos < shown.length && seen < caret.current; pos++) if (shown[pos] !== '.') seen++;
    el.setSelectionRange(pos, pos);
    caret.current = null;
  }, [shown]);
  return (
    <input {...rest} ref={ref} type="text" inputMode={decimal ? 'decimal' : 'numeric'} className={`${className} text-right tabular-nums`} value={shown}
      onChange={(e) => {
        const el = e.target;
        let text = el.value;
        // gõ dấu chấm ở bàn phím số cho phần thập phân thì hiểu là dấu phẩy
        const at = el.selectionStart ?? text.length;
        if (decimal && !text.includes(',') && (e.nativeEvent as InputEvent).data === '.') text = `${text.slice(0, at - 1)},${text.slice(at)}`;
        caret.current = text.slice(0, at).replace(/\./g, '').length;
        onValue(toRaw(text, decimal, signed));
      }} />
  );
}
