/**
 * Ghi bản ghi ngầm khi người dùng bấm Điền vào FBO: không hiện gì trên giao diện, lỗi không chặn việc điền.
 * Cùng dữ liệu thì chỉ ghi một lần; dữ liệu đã sửa thì ghi lại (máy chủ ghi đè theo khoá nghiệp vụ). Ghi lỗi thì lần sau thử lại.
 */
export function createSilentSaver(save) {
  let last = null; // { key, promise }
  return function (type, data, fileIds) {
    if (!fileIds || !fileIds.length) return Promise.resolve(null);
    const key = JSON.stringify([type, fileIds, data]);
    if (last && last.key === key) return last.promise;
    const before = last ? last.promise : Promise.resolve(); // ghi lần lượt, bản sửa sau không bị bản trước đè
    const entry = { key };
    entry.promise = before.then(() => save(type, data, fileIds)).then(
      (r) => ({ period: r.period || thisPeriod(), fileId: r.fileId || fileIds[0] }),
      (e) => { console.warn('Chưa ghi được bản ghi:', e && e.message); if (last === entry) last = null; return null; }
    );
    last = entry;
    return entry.promise;
  };
}

function thisPeriod() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
