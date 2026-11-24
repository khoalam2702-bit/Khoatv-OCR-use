// Định dạng kết quả "Dò form" thành văn bản gọn để dán cho người lập ánh xạ: mỗi ô một dòng.
export function formatInspect(frames) {
  const out = [];
  (frames || []).forEach((f, i) => {
    out.push('# Khung ' + (i + 1) + ': ' + (f.title || '') + ' ' + (f.url || ''));
    (f.controls || []).forEach((c) => {
      const key = c.id || c.name || c.selector || '(không id)';
      let line = key + ' | ' + c.tag + (c.type && c.type !== c.tag ? '/' + c.type : '') + ' | ' + (c.label || c.placeholder || '') + (c.visible ? '' : ' | ẩn');
      if (c.options && c.options.length) line += ' | chọn: ' + c.options.slice(0, 8).join('; ');
      out.push(line);
    });
  });
  return out.join('\n');
}

export function countControls(frames) {
  return (frames || []).reduce((n, f) => n + ((f.controls || []).length), 0);
}
