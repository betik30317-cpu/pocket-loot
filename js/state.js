import { CONFIG } from './config.js';

const SAVE_KEY = 'pocketLoot.save';

export function newState() {
  return {
    version: CONFIG.version,
    level: 1,
    exp: 0,
    hp: CONFIG.player.hpBase,
    gold: 0,
    zone: 1,
    unlockedZone: 1,
    equipped: { weapon: null, hat: null, armor: null, accessory: null },
    bag: [],
    autoDecompose: 0,      // 0 不分解；1 普通；2 普通與魔法；3 普通、魔法與稀有
    bagSort: 'rarity',     // rarity | slot | zone
    skills: {},            // 技能 id → 等級
    killsSinceLegend: 0,
    nextItemId: 1,
    monster: null,
    log: [],
    stats: { kills: 0, legends: 0, deaths: 0 },
    bossesDefeated: [],
    startedAt: Date.now(),
    clearedAt: null,
    savedAt: Date.now(),
  };
}

export function expToNext(level) {
  if (level >= CONFIG.player.levelCap) return 0;
  return CONFIG.player.expCoef * level * level;
}

// 角色最終數值。override 用於裝備比較：{ slot, item } 代表假設換上 item。
export function computeStats(state, override) {
  const p = CONFIG.player;
  const lv = state.level - 1;
  const s = {
    atk: p.atkBase + p.atkPerLevel * lv,
    hp: p.hpBase + p.hpPerLevel * lv,
    def: p.defBase + p.defPerLevel * lv,
    crit: p.critBase,
    loot: 0,
    effects: new Set(),
  };
  for (const slot of CONFIG.slots) {
    const item = override && override.slot === slot.id ? override.item : state.equipped[slot.id];
    if (!item) continue;
    s[slot.stat] += item.main * (1 + CONFIG.enhance.perLevel * (item.enh || 0));
    for (const a of item.affixes) s[a.stat] += a.value;
    if (item.legend) s.effects.add(CONFIG.legendaries.find(l => l.slot === item.slot).effect);
  }
  // 技能樹（03）
  const sk = id => (state.skills && state.skills[id]) || 0;
  const per = id => skillDef(id).per;
  s.atk *= 1 + per('smash') * sk('smash');
  s.def *= 1 + per('thick') * sk('thick');
  s.crit += per('clover') * sk('clover');
  s.loot += per('finder') * sk('finder');
  s.regen = p.regenPerSec + per('nap') * sk('nap');
  s.extraHit = per('combo') * sk('combo');

  s.crit = Math.min(s.crit, p.critCap);
  s.loot = Math.min(s.loot, p.lootFindCap);
  s.hp = Math.round(s.hp);
  return s;
}

// ---------- 技能樹 ----------
export function skillDef(id) {
  for (const b of CONFIG.skills.branches) {
    const found = b.skills.find(x => x.id === id);
    if (found) return found;
  }
  throw new Error('unknown skill ' + id);
}

export function skillPointsTotal(state) { return state.level - 1; }
export function skillPointsSpent(state) {
  return Object.values(state.skills || {}).reduce((a, b) => a + b, 0);
}
export function skillPointsFree(state) { return skillPointsTotal(state) - skillPointsSpent(state); }

// 回傳不能學習的原因，可以學習時回傳 null
export function learnBlocker(state, id) {
  const lv = state.skills[id] || 0;
  if (lv >= CONFIG.skills.maxLevel) return '已達最高等級';
  for (const b of CONFIG.skills.branches) {
    const i = b.skills.findIndex(x => x.id === id);
    if (i > 0) {
      const first = b.skills[0];
      if ((state.skills[first.id] || 0) < CONFIG.skills.unlockAt) return `需要${first.name} ${CONFIG.skills.unlockAt} 級`;
    }
  }
  if (skillPointsFree(state) <= 0) return '沒有技能點';
  return null;
}

export function learnSkill(state, id) {
  if (learnBlocker(state, id)) return false;
  state.skills[id] = (state.skills[id] || 0) + 1;
  return true;
}

export function resetSkills(state) { state.skills = {}; }

// 存檔不含戰鬥中的怪物與戰鬥紀錄；首領戰不會被存下來
function serialize(state) {
  const copy = { ...state, monster: null, log: state.log.slice(-60), savedAt: Date.now() };
  return JSON.stringify(copy);
}

function revive(data) {
  if (!data || typeof data !== 'object' || data.version !== CONFIG.version) return null;
  if (!Number.isFinite(data.level) || !data.equipped || !Array.isArray(data.bag)) return null;
  const s = { ...newState(), ...data, monster: null };
  s.stats = { ...newState().stats, ...(data.stats || {}) };
  return s;
}

export function save(state) {
  try {
    state.savedAt = Date.now();
    localStorage.setItem(SAVE_KEY, serialize(state));
  } catch (e) { /* 瀏覽器不允許儲存時略過 */ }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return revive(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

// ---------- 存檔碼（10）----------
const CODE_PREFIX = 'PL1-';

export function exportCode(state) {
  const bytes = new TextEncoder().encode(serialize(state));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return CODE_PREFIX + btoa(bin);
}

// 成功回傳狀態物件，失敗回傳 null
export function importCode(code) {
  try {
    const trimmed = String(code).trim().replace(/\s+/g, '');
    if (!trimmed.startsWith(CODE_PREFIX)) return null;
    const bin = atob(trimmed.slice(CODE_PREFIX.length));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return revive(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 略過 */ }
}
