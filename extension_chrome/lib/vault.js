// Mã hoá mật khẩu lưu trên máy bằng AES-GCM. Khoá là CryptoKey không xuất được, lưu trong IndexedDB của extension:
// bản sao tệp storage hoặc dữ liệu đồng bộ không đủ để giải mã. Không chống được mã độc chạy ngay trong trình duyệt này.
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createVault({ getKey, subtle } = {}) {
  const sub = () => subtle || globalThis.crypto.subtle;
  return {
    async encrypt(plain) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ct = await sub().encrypt({ name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(String(plain)));
      return 'v1.' + b64(iv) + '.' + b64(ct);
    },
    async decrypt(token) {
      const m = /^v1\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)$/.exec(String(token || ''));
      if (!m) throw new Error('Dữ liệu mã hoá không hợp lệ.');
      const pt = await sub().decrypt({ name: 'AES-GCM', iv: unb64(m[1]) }, await getKey(), unb64(m[2]));
      return new TextDecoder().decode(pt);
    }
  };
}

let cached;
/** Nguồn khoá thật: tạo khoá AES-GCM không xuất được và giữ trong IndexedDB. */
export function idbKeyProvider() {
  return async () => {
    if (cached) return cached;
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('khoatv-vault', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('k');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    let key = await new Promise((res, rej) => { const q = db.transaction('k').objectStore('k').get('main'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await new Promise((res, rej) => { const tx = db.transaction('k', 'readwrite'); tx.objectStore('k').put(key, 'main'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    }
    cached = key;
    return key;
  };
}
