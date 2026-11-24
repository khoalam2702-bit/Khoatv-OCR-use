/* Chạy trong trang FBO (tiêm bằng chrome.scripting, mọi frame). Định nghĩa hai hàm toàn cục, không tự chạy gì.
 *  __KHOATV_FILL__(mapping, data, opts) -> { filled: [k], notFound: [k], empty: [k] }
 *       opts.src = mã loại tài liệu đang điền: ô được điền sẽ gắn data-khoatv-src; tính thử báo foreign=true khi ô đã do loại khác điền
 *       opts.dry = true: chỉ tính thử, KHÔNG ghi vào form; trả thêm overwrite: [{ k, old, v }] = ô đang có giá trị khác sẽ bị ghi đè
 *  __KHOATV_PROBE__(mapping)       -> { found: [selector] } các ô của ánh xạ đang có trên trang (để chờ form / kiểm tra đúng form)
 *  __KHOATV_INSPECT__()            -> danh sách ô nhập của trang (để lập ánh xạ trường)
 * mapping: { "<mã trường OCR>": "<css selector>" | { selector, map?, format?, transform? } | [ nhiều mục như trên ] }
 *   map:    { "Nam": "1", "Nữ": "0" }  đổi giá trị OCR sang giá trị ô chọn
 *   format: "iso" ép ngày dd/MM/yyyy thành yyyy-MM-dd (ô type=date tự nhận); "date" chỉ điền khi giá trị đúng dd/MM/yyyy
 *   prefix + append: dồn nhiều trường OCR vào một ô (vd Ghi chú): "Kỹ năng: ...; Kinh nghiệm: ...", tự cắt theo maxlength của ô
 *   fixed:  giá trị cố định luôn điền (không cần OCR), vd mã loại giấy tờ "02"
 *   contains: true thì khoá của map chỉ cần nằm TRONG giá trị OCR (vd "Hồ Chí Minh" khớp "CA TP Hồ Chí Minh"), khoá dài được ưu tiên
 *   transform: "name_head" (họ + tên đệm) | "name_last" (tên): tách họ tên vào 2 ô
 */
(function () {
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function dmyToIso(s) {
    var m = /^\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\s*$/.exec(String(s == null ? '' : s));
    return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : String(s == null ? '' : s);
  }
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })); }

  function setNative(el, value) {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }

  function setSelect(el, value) {
    var want = norm(value), idx = -1, i;
    for (i = 0; i < el.options.length && idx < 0; i++) if (norm(el.options[i].value) === want) idx = i;
    for (i = 0; i < el.options.length && idx < 0; i++) if (norm(el.options[i].text) === want) idx = i;
    if (idx < 0) return false;
    el.selectedIndex = idx;
    fire(el, 'input'); fire(el, 'change');
    return true;
  }

  function setRadio(selector, value) {
    var els = document.querySelectorAll(selector), want = norm(value);
    for (var i = 0; i < els.length; i++) {
      var r = els[i];
      var label = r.labels && r.labels[0] ? r.labels[0].textContent : '';
      if (r.type === 'radio' && (norm(r.value) === want || norm(label) === want)) {
        r.checked = true; fire(r, 'input'); fire(r, 'change'); return true;
      }
    }
    return false;
  }

  var DATE_RE = /^\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\s*$/;

  function mapValue(map, v, contains) {
    if (!map) return v;
    if (Object.prototype.hasOwnProperty.call(map, v)) return map[v];
    var nv = norm(v), keys = Object.keys(map), i;
    for (i = 0; i < keys.length; i++) if (norm(keys[i]) === nv) return map[keys[i]];
    if (contains) {
      keys.sort(function (a, b) { return b.length - a.length; });
      for (i = 0; i < keys.length; i++) if (nv.indexOf(norm(keys[i])) >= 0) return map[keys[i]];
      return ''; // không khớp mã nào thì không điền, tránh đưa chữ vào ô mã
    }
    return v;
  }

  /* transform: name_head = họ và tên đệm (bỏ từ cuối), name_last = tên (từ cuối) */
  function transform(v, t) {
    var parts = String(v).trim().split(/\s+/);
    if (t === 'name_last') return parts[parts.length - 1];
    if (t === 'name_head') return parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    return v;
  }

  var curSrc = '';
  function setOne(selector, value, spec, touched, dry) {
    var el = document.querySelector(selector);
    if (!el) return 'notFound';
    var v = spec.fixed !== undefined ? String(spec.fixed) : transform(value, spec.transform);
    if (v === '') return 'empty';
    if (spec.format === 'date' && !DATE_RE.test(v)) return 'empty'; // vd "Không thời hạn": bỏ qua, không điền
    v = mapValue(spec.map, v, spec.contains);
    if (v === '') return 'empty';
    if (dry && (el.tagName === 'SELECT' || el.type === 'radio' || el.type === 'checkbox')) return 'ok'; // tính thử: không đổi ô chọn
    if (el.tagName === 'SELECT') return setSelect(el, v) ? 'ok' : 'notFound';
    if (el.type === 'radio') return setRadio(selector, v) ? 'ok' : 'notFound';
    if (el.type === 'checkbox') {
      el.checked = /^(1|true|x|co|yes)$/.test(norm(v));
      fire(el, 'input'); fire(el, 'change'); return 'ok';
    }
    if (el.type === 'date' || spec.format === 'iso') v = dmyToIso(v);
    v = String(v);
    if (dry && spec.append) return 'ok'; // ô dồn nhiều trường (Ghi chú): luôn nối thêm, không tính là ghi đè
    if (spec.prefix) v = spec.prefix + v;
    // append: nhiều trường OCR dồn vào cùng một ô (ví dụ Ghi chú), cách nhau bằng "; "
    if (spec.append && touched.has(el) && el.value) v = el.value + '; ' + v;
    touched.add(el);
    if (el.maxLength > 0 && v.length > el.maxLength) v = v.slice(0, el.maxLength);
    if (dry) { dry.push({ old: String(el.value || ''), v: v, src: el.getAttribute('data-khoatv-src') || '' }); return 'ok'; } // chỉ ghi nhận giá trị cũ / mới
    if (curSrc) el.setAttribute('data-khoatv-src', curSrc); // đánh dấu ô do loại tài liệu nào điền, để loại khác điền sau còn hỏi trước khi ghi đè
    try { el.focus(); } catch (e) { /* bỏ qua */ }
    setNative(el, String(v));
    fire(el, 'input'); fire(el, 'change'); fire(el, 'blur');
    try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (e) { /* bỏ qua */ }
    return 'ok';
  }

  globalThis.__KHOATV_PROBE__ = function (mapping) {
    var found = {};
    Object.keys(mapping || {}).forEach(function (k) {
      (Array.isArray(mapping[k]) ? mapping[k] : [mapping[k]]).forEach(function (sp) {
        var sel = typeof sp === 'string' ? sp : sp && sp.selector;
        if (!sel) return;
        try { if (document.querySelector(sel)) found[sel] = 1; } catch (e) { /* selector sai: coi như không thấy */ }
      });
    });
    return { found: Object.keys(found) };
  };

  globalThis.__KHOATV_FILL__ = function (mapping, data, opts) {
    var out = { filled: [], notFound: [], empty: [] };
    var touched = new Set();
    var dryOn = !!(opts && opts.dry);
    curSrc = (opts && opts.src) || '';
    if (dryOn) out.overwrite = [];
    Object.keys(mapping || {}).forEach(function (k) {
      if (opts && opts.only && opts.only.indexOf(k) < 0) return; // chỉ điền các khóa này
      if (opts && opts.except && opts.except.indexOf(k) >= 0) return; // bỏ qua các khóa này (điền ở lượt sau)
      var specs = Array.isArray(mapping[k]) ? mapping[k] : [mapping[k]];
      var val = data ? data[k] : null;
      var hasFixed = specs.some(function (sp) { return sp && typeof sp === 'object' && sp.fixed !== undefined; });
      if (!hasFixed && (val === null || val === undefined || val === '')) { out.empty.push(k); return; }
      var ok = 0, miss = 0, skip = 0;
      specs.forEach(function (spec) {
        if (typeof spec === 'string') spec = { selector: spec };
        if (!spec || !spec.selector) return;
        var r, dry = dryOn ? [] : null;
        try { r = setOne(spec.selector, val, spec, touched, dry); } catch (e) { r = 'notFound'; }
        if (dry) dry.forEach(function (d) { if (d.old.trim() !== '' && norm(d.old) !== norm(d.v)) out.overwrite.push({ k: k, old: d.old, v: d.v, src: d.src, foreign: !!d.src && d.src !== curSrc }); });
        if (r === 'ok') ok++; else if (r === 'empty') skip++; else miss++;
      });
      if (miss) out.notFound.push(k);
      else if (ok) out.filled.push(k);
      else if (skip) out.empty.push(k);
    });
    return out;
  };

  /** Đọc lại giá trị hiện có của các ô (để kiểm tra form có xóa mất giá trị vừa điền không). */
  globalThis.__KHOATV_READ__ = function (selectors) {
    return (selectors || []).map(function (sel) {
      var el = null;
      try { el = document.querySelector(sel); } catch (e) { /* selector sai */ }
      return { sel: sel, found: !!el, value: el ? String(el.value || '') : '' };
    });
  };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function byId(suffix) { return document.querySelector('[id$="' + suffix + '"]'); }
  function typeInto(el, v) {
    try { el.focus(); } catch (e) { /* bỏ qua */ }
    setNative(el, String(v)); fire(el, 'input'); fire(el, 'change'); fire(el, 'blur');
  }

  /* Trang hiện tại có đang hiển thị form đăng nhập FBO (ô Tên + ô Mật khẩu) không. Không có = coi như đã đăng nhập. */
  globalThis.__KHOATV_LOGIN_STATE__ = function () {
    var user = byId('txtUserName'), pass = byId('txtPassword');
    var shown = !!(user && pass && (pass.offsetWidth || pass.offsetHeight || pass.getClientRects().length));
    return { loginPage: shown };
  };

  /* Điền form đăng nhập FBO (Tên, Mật khẩu) rồi bấm "Nhận"; ô Công ty/Đơn vị giữ nguyên giá trị FBO đang chọn. p = { user, password, submit } */
  globalThis.__KHOATV_LOGIN__ = async function (p) {
    var user = byId('txtUserName'), pass = byId('txtPassword');
    if (!user || !pass) return { ok: false, reason: 'Tab hiện tại không phải trang đăng nhập FBO.' };
    var notes = [];
    if (p.user) typeInto(user, p.user);
    if (p.password) typeInto(pass, p.password);
    if (p.submit === false) return { ok: true, submitted: false, notes: notes };
    var cands = document.querySelectorAll('button, input[type=button], input[type=submit], a, span, div'), btn = null;
    for (var i = 0; i < cands.length && !btn; i++) {
      var e = cands[i], t = norm(e.value || (e.children.length === 0 ? e.textContent : ''));
      if ((t === 'nhan' || t === 'dang nhap' || t === 'login') && (e.offsetWidth || e.offsetHeight)) btn = e;
    }
    if (btn) { btn.click(); return { ok: true, submitted: true, notes: notes }; }
    pass.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    return { ok: true, submitted: false, notes: notes.concat('Không thấy nút "Nhận", đã gửi phím Enter.') };
  };

  function labelOf(el) {
    var t = '';
    if (el.labels && el.labels[0]) t = el.labels[0].textContent;
    if (!t && el.getAttribute('aria-label')) t = el.getAttribute('aria-label');
    if (!t) {
      var wrap = el.closest('label');
      if (wrap) t = wrap.textContent;
    }
    if (!t) {
      var prev = el.previousElementSibling;
      if (prev) t = prev.textContent;
    }
    return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function esc(s) { return globalThis.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'); }

  function selectorOf(el) {
    if (el.id && document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    var name = el.getAttribute('name');
    if (name) {
      var s = el.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\"') + '"]';
      if (document.querySelectorAll(s).length === 1) return s;
    }
    return '';
  }

  globalThis.__KHOATV_INSPECT__ = function () {
    var list = [];
    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      var type = el.type || el.tagName.toLowerCase();
      if (type === 'hidden' || type === 'button' || type === 'submit' || type === 'image') return;
      var item = {
        tag: el.tagName.toLowerCase(), type: type, id: el.id || '', name: el.getAttribute('name') || '',
        placeholder: el.getAttribute('placeholder') || '', label: labelOf(el), selector: selectorOf(el),
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      };
      if (el.tagName === 'SELECT') item.options = Array.prototype.slice.call(el.options, 0, 30).map(function (o) { return o.value + '|' + o.text; });
      list.push(item);
    });
    return { url: location.href, title: document.title, controls: list };
  };
})();
