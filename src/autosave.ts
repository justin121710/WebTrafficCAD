/**
 * 自動儲存：將專案快照存入瀏覽器 IndexedDB（容量足以存放底圖），
 * 不支援 IndexedDB 時退回 localStorage（不含底圖）。
 */
const DB_NAME = 'webtrafficcad';
const STORE = 'autosave';
const KEY = 'current';
const LS_KEY = 'webtrafficcad.autosave';

export interface AutosaveRecord {
  savedAt: string;
  project: any;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 自動暫存；回傳是否成功（IndexedDB 失敗時改存 localStorage，兩者都失敗才回傳 false） */
export async function saveAutosave(project: any): Promise<boolean> {
  const record: AutosaveRecord = { savedAt: new Date().toISOString(), project };
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    try {
      const slim = { ...record, project: { ...project, bgImage: null } };
      localStorage.setItem(LS_KEY, JSON.stringify(slim));
      return true;
    } catch {
      // 儲存空間不足或被封鎖：由呼叫端提示使用者另存專案檔
      return false;
    }
  }
}

export async function loadAutosave(): Promise<AutosaveRecord | null> {
  try {
    const db = await openDb();
    const rec = await new Promise<AutosaveRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (rec) return rec;
  } catch {
    // 改用 localStorage
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
