import { redirect } from 'next/navigation';

// Vào link gốc là thấy ngay chức năng Quét OCR; Bản ghi, Tài khoản, Cài đặt AI nằm ở thanh menu cùng trang.
export default function Home() { redirect('/scan'); }
