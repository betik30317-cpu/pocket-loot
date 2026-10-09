import { CONFIG } from './config.js';
import { newState, load, save, clearSave, computeStats } from './state.js';
import { makeItem } from './loot.js';
import { tick, addLog } from './combat.js';
import { initUI, render, showLegendToast, setState } from './ui.js';

const TICK_MS = 1000;
const MAX_CATCHUP_TICKS = 60;      // 離線結算在里程碑 3 加入，目前最多補算 60 回合
const SAVE_EVERY_MS = 10000;

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
if (!state) {
  state = freshState();
  addLog(state, '冒險開始！角色會自動打怪，掉到的裝備在右邊的背包。', 'good', true);
}

let speed = 1;
let last = performance.now();
let acc = 0;
let dirty = true;
let lastSave = Date.now();

function markDirty() { dirty = true; }

function loop() {
  const now = performance.now();
  const elapsed = now - last;
  last = now;
  acc += elapsed * speed;
  let n = Math.floor(acc / TICK_MS);
  acc -= n * TICK_MS;
  if (n > MAX_CATCHUP_TICKS * speed) n = MAX_CATCHUP_TICKS * speed;
  for (let i = 0; i < n; i++) {
    const ev = tick(state);
    if (ev.legend) showLegendToast(ev.legend);
  }
  if (n > 0) dirty = true;
  if (Date.now() - lastSave > SAVE_EVERY_MS) { save(state); lastSave = Date.now(); }
}

function frame() {
  if (dirty) { render(); dirty = false; }
  requestAnimationFrame(frame);
}

initUI(state, () => { save(state); markDirty(); });
setInterval(loop, 200);
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => { if (document.hidden) save(state); });
window.addEventListener('pagehide', () => save(state));

// ---------- 開發用工具 ----------
document.querySelectorAll('[data-speed]').forEach(btn => {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', b === btn));
  });
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
  state = freshState();
  addLog(state, '存檔已清除，冒險重新開始！', 'good', true);
  setState(state);
  save(state);
  markDirty();
});
