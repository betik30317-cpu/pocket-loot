import { CONFIG } from './config.js';
import { newState, load, save, clearSave, computeStats } from './state.js';
import { makeItem } from './loot.js';
import { tick, addLog } from './combat.js';
import { settleOffline } from './offline.js';
import { initUI, render, showLegendToast, showOfflineCard, showEnding, setState } from './ui.js';

const TICK_MS = 1000;
const SAVE_EVERY_MS = 10000;
const OFFLINE_MS = CONFIG.offline.minSeconds * 1000;

// 新角色帶一套第 1 區的普通裝備出發
function freshState() {
  const s = newState();
  for (const slot of CONFIG.slots) s.equipped[slot.id] = makeItem(s, 1, 0, slot.id);
  s.equipped.weapon.name = '新手小劍';
  s.equipped.hat.name = '新手帽子';
  s.equipped.armor.name = '新手衣服';
  s.equipped.accessory.name = '新手戒指';
  s.hp = computeStats(s).hp;
  return s;
}

let state = load();
let pendingOffline = 0;
if (!state) {
  state = freshState();
  addLog(state, '冒險開始！角色會自動打怪，掉到的裝備在右邊的背包。', 'good', true);
} else {
  pendingOffline = Date.now() - (state.savedAt || Date.now());
}

let speed = 1;
let last = Date.now();
let acc = 0;
let dirty = true;
let lastSave = Date.now();

function markDirty() { dirty = true; }

function runOffline(ms) {
  const summary = settleOffline(state, ms / 1000);
  save(state);
  lastSave = Date.now();
  showOfflineCard(summary);
  markDirty();
}

function loop() {
  // 分頁在背景時暫停；回到前景時把整段離開的時間一次結算
  if (document.hidden) return;
  const now = Date.now();
  const elapsed = now - last;
  last = now;

  // 分頁在背景或電腦睡著超過 1 分鐘：改用離線結算（10）
  if (elapsed > OFFLINE_MS && speed === 1) {
    acc = 0;
    runOffline(elapsed);
    return;
  }

  acc += elapsed * speed;
  let n = Math.floor(acc / TICK_MS);
  acc -= n * TICK_MS;
  n = Math.min(n, 60 * speed);
  for (let i = 0; i < n; i++) {
    const ev = tick(state);
    if (ev.legend) showLegendToast(ev.legend);
    if (ev.cleared) { save(state); showEnding(); }
  }
  if (n > 0) dirty = true;
  if (now - lastSave > SAVE_EVERY_MS) { save(state); lastSave = now; }
}

function frame() {
  if (dirty) { render(); dirty = false; }
  requestAnimationFrame(frame);
}

function replaceState(next) {
  state = next;
  setState(state);
  save(state);
  markDirty();
}

initUI(
  state,
  () => { save(state); markDirty(); },
  imported => {
    imported.savedAt = Date.now();
    replaceState(imported);
    addLog(state, '已匯入存檔碼', 'good', true);
  },
);

if (pendingOffline > OFFLINE_MS) runOffline(pendingOffline);
setInterval(loop, 200);
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) save(state);
  else loop();
});
window.addEventListener('pagehide', () => save(state));

// ---------- 開發用工具 ----------
document.querySelectorAll('[data-speed]').forEach(btn => {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', b === btn));
  });
});

document.querySelector('#devOfflineGo').addEventListener('click', () => {
  runOffline(Number(document.querySelector('#devOffline').value) * 1000);
});

const resetBtn = document.querySelector('#resetSave');
let resetTimer = null;
resetBtn.addEventListener('click', () => {
  if (!resetBtn.classList.contains('warn')) {
    resetBtn.classList.add('warn');
    resetBtn.textContent = '再按一次確認清除';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { resetBtn.classList.remove('warn'); resetBtn.textContent = '清除存檔'; }, 3000);
    return;
  }
  clearTimeout(resetTimer);
  resetBtn.classList.remove('warn');
  resetBtn.textContent = '清除存檔';
  clearSave();
  replaceState(freshState());
  addLog(state, '存檔已清除，冒險重新開始！', 'good', true);
});
