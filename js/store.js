/* Red Ress Billing — file storage
 *
 * Every record is a real file, addressed by a path such as
 *   settings.json
 *   parties.json
 *   bills/data/Saha_Agencies/2024-06-27_BL-103.json
 *   bills/pdf/Saha_Agencies/2024-06-27_BL-103.pdf
 *
 * Where the files live (picked automatically, best first):
 *   1. "folder"  – a folder on this computer the user linked (Chrome / Edge on Windows, Mac, Linux, ChromeOS)
 *   2. "device"  – the app's private file system on this device (OPFS: Android tablets, desktop browsers, newer iPads)
 *   3. "browser" – files kept in the browser's database (fallback for older iPads / Safari)
 * All three expose the same small API: write, read, remove, list.
 */
(function () {
  'use strict';
  const DB_NAME = 'rr-billing';

  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbReq(store, mode, fn) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => { db.close(); res(req && req.result); };
      tx.onerror = () => { db.close(); rej(tx.error); };
      tx.onabort = () => { db.close(); rej(tx.error); };
    });
  }
  const kvGet = k => idbReq('kv', 'readonly', s => s.get(k));
  const kvSet = (k, v) => idbReq('kv', 'readwrite', s => s.put(v, k));
  const kvDel = k => idbReq('kv', 'readwrite', s => s.delete(k));

  const toBlob = data => data instanceof Blob ? data : new Blob([data], {type: 'application/json'});
  const split = path => { const parts = String(path).split('/').filter(Boolean); const name = parts.pop(); return {parts, name}; };
  const notFound = e => e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

  /* A directory handle: either a linked folder or the private file system */
  class DirFS {
    constructor(root, kind, label) { this.root = root; this.kind = kind; this.label = label; }
    async dir(parts, create) { let d = this.root; for (const p of parts) d = await d.getDirectoryHandle(p, {create}); return d; }
    async write(path, data) {
      const {parts, name} = split(path);
      const d = await this.dir(parts, true);
      const fh = await d.getFileHandle(name, {create: true});
      const w = await fh.createWritable();
      await w.write(toBlob(data));
      await w.close();
    }
    async read(path) {
      const {parts, name} = split(path);
      try { const d = await this.dir(parts, false); const fh = await d.getFileHandle(name); return await fh.getFile(); }
      catch (e) { if (notFound(e)) return null; throw e; }
    }
    async remove(path) {
      const {parts, name} = split(path);
      try {
        const d = await this.dir(parts, false); await d.removeEntry(name);
        // tidy now-empty party folders
        for (let i = parts.length; i > 0; i--) {
          const parent = await this.dir(parts.slice(0, i - 1), false);
          const child = await parent.getDirectoryHandle(parts[i - 1]);
          let empty = true; for await (const _ of child.keys()) { empty = false; break; }
          if (!empty) break;
          await parent.removeEntry(parts[i - 1]);
        }
      } catch (e) { if (!notFound(e)) throw e; }
    }
    async list(prefix = '') {
      const out = [];
      const parts = String(prefix).split('/').filter(Boolean);
      let start;
      try { start = await this.dir(parts, false); } catch (e) { if (notFound(e)) return out; throw e; }
      const walk = async (d, base) => {
        for await (const [n, h] of d.entries()) {
          if (n.startsWith('.')) continue;
          const p = base ? base + '/' + n : n;
          if (h.kind === 'directory') await walk(h, p); else out.push(p);
        }
      };
      await walk(start, parts.join('/'));
      return out.sort();
    }
  }

  /* Fallback: the same paths, kept in the browser database */
  class IdbFS {
    constructor() { this.kind = 'browser'; this.label = 'Browser storage on this device'; }
    write(path, data) { return idbReq('files', 'readwrite', s => s.put(toBlob(data), path)); }
    async read(path) { const b = await idbReq('files', 'readonly', s => s.get(path)); return b || null; }
    remove(path) { return idbReq('files', 'readwrite', s => s.delete(path)); }
    async list(prefix = '') {
      const keys = await idbReq('files', 'readonly', s => s.getAllKeys());
      const p = String(prefix).replace(/\/$/, '');
      return (keys || []).filter(k => !p || k === p || k.startsWith(p + '/')).sort();
    }
  }

  async function openDeviceStorage() {
    try {
      if (navigator.storage && navigator.storage.getDirectory && window.FileSystemFileHandle && 'createWritable' in FileSystemFileHandle.prototype) {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('billing-data', {create: true});
        const fs = new DirFS(dir, 'device', 'App storage on this device');
        await fs.write('.probe', 'ok'); await fs.remove('.probe');
        return fs;
      }
    } catch (e) { console.warn('Private file system unavailable, using browser storage', e); }
    return new IdbFS();
  }

  /* Returns {fs} or {locked: handle} when a linked folder needs permission again */
  async function openStorage() {
    if (window.showDirectoryPicker) {
      try {
        const h = await kvGet('folder');
        if (h) {
          const perm = await h.queryPermission({mode: 'readwrite'});
          if (perm === 'granted') return {fs: new DirFS(h, 'folder', 'Folder on this computer: ' + h.name)};
          return {locked: h};
        }
      } catch (e) { console.warn(e); }
    }
    return {fs: await openDeviceStorage()};
  }

  async function copyAll(src, dst, overwrite) {
    let n = 0;
    for (const p of await src.list('')) {
      if (!overwrite && await dst.read(p)) continue;
      const b = await src.read(p); if (b) { await dst.write(p, b); n++; }
    }
    return n;
  }

  async function readText(fs, path) { const b = await fs.read(path); return b ? await b.text() : null; }
  async function readJSON(fs, path) { const t = await readText(fs, path); if (t == null) return null; try { return JSON.parse(t); } catch (e) { console.warn('Bad JSON in', path); return null; } }
  const writeJSON = (fs, path, obj) => fs.write(path, new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json'}));

  window.RRStore = {openStorage, openDeviceStorage, DirFS, IdbFS, copyAll, readText, readJSON, writeJSON, kvGet, kvSet, kvDel};
})();
