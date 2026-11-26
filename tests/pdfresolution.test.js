// Độ phân giải đọc tệp gửi Gemini: PDF dùng mức trung bình, ảnh dùng mức cao.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const props = { GEMINI_API_KEY: 'AIzaSy' + 'A'.repeat(33) }; const sent = []; const store = {};
const ok = { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) };
const ctx = {
  console: { log() {}, error() {} },
  Utilities: { sleep() {}, formatDate: () => '00:00:00', base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'), computeDigest: (a, s) => Array.from(require('crypto').createHash('sha256').update(String(s)).digest()), DigestAlgorithm: { SHA_256: 1 } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } }) },
  UrlFetchApp: { fetch: (url, o) => { sent.push(JSON.parse(o.payload).generationConfig.mediaResolution); return ok; } }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const call = (type, mimes) => { vm.runInContext('callGemini_(DOC_TYPES.' + type + ', ' + JSON.stringify(mimes.map(m => ({ mimeType: m, b64: 'x' }))) + ')', ctx); return sent.pop(); };
assert.strictEqual(call('CV_UNGVIEN', ['application/pdf']), 'MEDIA_RESOLUTION_MEDIUM');
assert.strictEqual(call('CV_UNGVIEN', ['image/jpeg']), 'MEDIA_RESOLUTION_HIGH');
assert.strictEqual(call('CCCD', ['application/pdf', 'image/jpeg']), 'MEDIA_RESOLUTION_HIGH');
assert.strictEqual(call('BIEN_SO_XE', ['image/jpeg']), 'MEDIA_RESOLUTION_MEDIUM');
console.log('pdfresolution.test OK');
