import { CONFIG } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function zoneOf(id) { return CONFIG.zones[id - 1]; }

function roundStat(stat, v) {
  if (stat === 'hp') return Math.max(1, Math.round(v));
  if (stat === 'crit' || stat === 'loot') return Math.round(v * 1000) / 1000;
  return Math.round(v * 10) / 10;
}

// 依掉寶率決定稀有度（05）：魔法、稀有、傳說的機率乘以 (1 + 掉寶率)，多出的從普通扣除
export function rollRarity(lootFind) {
  const base = CONFIG.drops.rarityChance;
  const m = 1 + lootFind;
  const p = [0, base[1] * m, base[2] * m, base[3] * m];
  p[0] = Math.max(0, 1 - p[1] - p[2] - p[3]);
  let r = Math.random();
  for (let i = 3; i >= 1; i--) { if (r < p[i]) return i; r -= p[i]; }
  return 0;
}

export function makeItem(state, zoneId, rarity, slotId) {
  const zone = zoneOf(zoneId);
  const rar = CONFIG.rarities[rarity];
  const slot = slotId ? CONFIG.slots.find(s => s.id === slotId) : pick(CONFIG.slots);
  const baseMain = slot.stat === 'crit'
    ? slot.base + slot.perZone * (zoneId - 1)
    : slot.base * zone.gearMult;
  const main = roundStat(slot.stat, baseMain * rar.mainMult * rand(...CONFIG.mainRoll));

  const pool = [...CONFIG.affixes];
  const affixes = [];
  for (let i = 0; i < rar.affixes && pool.length; i++) {
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const max = a.perZone !== undefined ? a.base + a.perZone * (zoneId - 1) : a.base * zone.gearMult;
    affixes.push({ stat: a.stat, value: roundStat(a.stat, max * rand(CONFIG.affixMinRoll, 1)) });
  }

  const legend = rarity === 3;
  const name = legend
    ? CONFIG.legendaries.find(l => l.slot === slot.id).name
    : zone.adj + slot.noun;

  return { id: state.nextItemId++, slot: slot.id, rarity, zone: zoneId, main, affixes, enh: 0, legend, name };
}

// 一般怪或精英擊敗後的掉寶判定；回傳物品或 null
export function rollDrop(state, zoneId, isElite, lootFind) {
  state.killsSinceLegend++;
  const chance = isElite ? CONFIG.drops.eliteChance : CONFIG.drops.normalChance;
  if (Math.random() >= chance) return null;

  let rarity;
  let slotId;
  if (state.killsSinceLegend >= CONFIG.drops.pityKills) {
    rarity = 3; // 保底
  } else {
    rarity = rollRarity(lootFind);
  }
  if (rarity === 3) {
    state.killsSinceLegend = 0;
    slotId = pick(CONFIG.legendaries).slot;
  }
  return makeItem(state, zoneId, rarity, slotId);
}

// 強化到下一級的費用；已達上限時回傳 null（07）
export function enhanceCost(item) {
  const lv = item.enh || 0;
  if (lv >= CONFIG.enhance.maxLevel) return null;
  return zoneOf(item.zone).gold * CONFIG.enhance.costCoef[lv];
}

export function enhanceItem(state, item) {
  const cost = enhanceCost(item);
  if (cost === null || state.gold < cost) return false;
  state.gold -= cost;
  item.enh = (item.enh || 0) + 1;
  return true;
}

// 首領必掉 1 件：稀有 90%、傳說 10%；掉到傳說時 70% 是該區對應的那件（05）
export function rollBossDrop(state, zoneId) {
  state.killsSinceLegend++;
  const d = CONFIG.drops;
  const legend = state.killsSinceLegend >= d.pityKills || Math.random() < d.bossLegendChance;
  if (!legend) return makeItem(state, zoneId, 2);
  state.killsSinceLegend = 0;
  const mapped = CONFIG.zones[zoneId - 1].bossLegend;
  let slotId;
  if (mapped && Math.random() < d.bossMappedChance) {
    slotId = mapped;
  } else {
    const others = CONFIG.legendaries.filter(l => l.slot !== mapped);
    slotId = pick(others).slot;
  }
  return makeItem(state, zoneId, 3, slotId);
}

export function decomposeValue(item) {
  return zoneOf(item.zone).gold * CONFIG.rarities[item.rarity].decompose;
}

// 放進背包或自動分解。回傳 { kept: true } 或 { kept: false, gold }
export function storeItem(state, item) {
  const belowThreshold = item.rarity < state.autoDecompose && !item.legend;
  const limit = item.legend ? CONFIG.bagSize + CONFIG.legendOverflow : CONFIG.bagSize;
  const bagFull = state.bag.length >= limit;
  if (belowThreshold || bagFull) {
    const gold = decomposeValue(item);
    state.gold += gold;
    return { kept: false, gold, reason: belowThreshold ? 'threshold' : 'full' };
  }
  state.bag.push(item);
  return { kept: true };
}
