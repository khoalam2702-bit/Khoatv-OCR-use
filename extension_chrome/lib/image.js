const MAX_SIDE = 2400;
const QUALITY = 0.92;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Không đọc được tệp.'));
    r.readAsDataURL(blob);
  });
}

/** Ảnh: nén JPEG chất lượng 0.92 qua canvas (cạnh dài tối đa 2400px). PDF: giữ nguyên. Trả { mimeType, base64, bytes, name }. */
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
