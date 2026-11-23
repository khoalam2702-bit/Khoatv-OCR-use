/* Chạy trong trang FBO (tiêm bằng chrome.scripting, mọi frame). Định nghĩa hai hàm toàn cục, không tự chạy gì.
 *  __KHOATV_FILL__(mapping, data)  -> { filled: [k], notFound: [k], empty: [k] }
 *  __KHOATV_INSPECT__()            -> danh sách ô nhập của trang (để lập ánh xạ trường)
 * mapping: { "<mã trường OCR>": "<css selector>" | { selector, map?, format?, transform? } | [ nhiều mục như trên ] }
 *   map:    { "Nam": "1", "Nữ": "0" }  đổi giá trị OCR sang giá trị ô chọn
 *   format: "iso" ép ngày dd/MM/yyyy thành yyyy-MM-dd (ô type=date tự nhận); "date" chỉ điền khi giá trị đúng dd/MM/yyyy
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

  function mapValue(map, v) {
    if (!map) return v;
    if (Object.prototype.hasOwnProperty.call(map, v)) return map[v];
    var nv = norm(v), keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) if (norm(keys[i]) === nv) return map[keys[i]];
    return v;
  }

  /* transform: name_head = họ và tên đệm (bỏ từ cuối), name_last = tên (từ cuối) */
  function transform(v, t) {
    var parts = String(v).trim().split(/\s+/);
    if (t === 'name_last') return parts[parts.length - 1];
    if (t === 'name_head') return parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    return v;
  }

  function setOne(selector, value, spec) {
    var el = document.querySelector(selector);
    if (!el) return 'notFound';
    var v = transform(value, spec.transform);
    if (v === '') return 'empty';
    if (spec.format === 'date' && !DATE_RE.test(v)) return 'empty'; // vd "Không thời hạn": bỏ qua, không điền
    v = mapValue(spec.map, v);
    if (el.tagName === 'SELECT') return setSelect(el, v) ? 'ok' : 'notFound';
    if (el.type === 'radio') return setRadio(selector, v) ? 'ok' : 'notFound';
    if (el.type === 'checkbox') {
      el.checked = /^(1|true|x|co|yes)$/.test(norm(v));
      fire(el, 'input'); fire(el, 'change'); return 'ok';
    }
    if (el.type === 'date' || spec.format === 'iso') v = dmyToIso(v);
    try { el.focus(); } catch (e) { /* bỏ qua */ }
    setNative(el, String(v));
    fire(el, 'input'); fire(el, 'change'); fire(el, 'blur');
    try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (e) { /* bỏ qua */ }
    return 'ok';
  }

  globalThis.__KHOATV_FILL__ = function (mapping, data) {
    var out = { filled: [], notFound: [], empty: [] };
    Object.keys(mapping || {}).forEach(function (k) {
      var specs = Array.isArray(mapping[k]) ? mapping[k] : [mapping[k]];
      var val = data ? data[k] : null;
      if (val === null || val === undefined || val === '') { out.empty.push(k); return; }
      var ok = 0, miss = 0, skip = 0;
      specs.forEach(function (spec) {
        if (typeof spec === 'string') spec = { selector: spec };
        if (!spec || !spec.selector) return;
        var r;
        try { r = setOne(spec.selector, val, spec); } catch (e) { r = 'notFound'; }
        if (r === 'ok') ok++; else if (r === 'empty') skip++; else miss++;
      });
      if (miss) out.notFound.push(k);
      else if (ok) out.filled.push(k);
      else if (skip) out.empty.push(k);
    });
    return out;
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
