const MAX_SIDE = 1600;
const QUALITY = 0.92;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Không đọc được tệp.'));
    r.readAsDataURL(blob);
  });
}

/** Ảnh: nén JPEG chất lượng 0.92 qua canvas (cạnh dài tối đa 1600px). PDF: giữ nguyên. Trả { mimeType, base64, bytes, name }. */
export async function prepareFile(file) {
  if (file.type === 'application/pdf') {
    const base64 = await blobToBase64(file);
    return { mimeType: 'application/pdf', base64, bytes: Math.floor(base64.length * 0.75), name: file.name };
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Chỉ hỗ trợ ảnh JPG, PNG, WEBP hoặc PDF.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Không nén được ảnh.');
  const base64 = await blobToBase64(blob);
  return { mimeType: 'image/jpeg', base64, bytes: blob.size, name: file.name };
}

/** Thu nhỏ ảnh đã nén (base64 JPEG) về cạnh dài tối đa maxSide trước khi gửi; ảnh đã nhỏ hơn thì giữ nguyên. Dùng cho giấy tờ chữ to như biển số xe. */
export async function shrinkBase64(file, maxSide, quality = 0.85) {
  if (!file || file.mimeType === 'application/pdf') return file;
  try {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: file.mimeType }));
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale >= 1) { bmp.close?.(); return file; }
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) return file;
    return { ...file, mimeType: 'image/jpeg', base64: await blobToBase64(blob), bytes: blob.size };
  } catch { return file; }
}
