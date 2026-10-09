import { CONFIG } from './config.js';
import { computeStats } from './state.js';
import { tick, levelUp, addLog } from './combat.js';
import { rollRarity, makeItem, storeItem } from './loot.js';

// 在某區快速模擬一段戰鬥，回傳每秒擊殺數與是否倒下（10）
function sampleZone(state, zoneId) {
  const sim = structuredClone({ ...state, log: [], monster: null });
  sim.zone = zoneId;
  sim.hp = computeStats(sim).hp;
  sim.autoDecompose = 4;           // 模擬時不保留任何掉寶，避免影響背包
  const startKills = sim.stats.kills;
  const startDeaths = sim.stats.deaths;
  const n = CONFIG.offline.sampleTicks;
  for (let i = 0; i < n; i++) {
    tick(sim);
    if (sim.zone !== zoneId) break;  // 倒下被送回上一區
  }
  const kills = sim.stats.kills - startKills;
  const died = sim.stats.deaths > startDeaths;
  return { killsPerSec: kills / n, died };
}

// 從目前區域往前找撐得住的區域；第 1 區一定撐得住
function pickZone(state) {
  for (let z = state.zone; z >= 1; z--) {
    const r = sampleZone(state, z);
    if (!r.died || z === 1) return { zone: z, ...r };
  }
  return { zone: 1, killsPerSec: 0, died: false };
}

// 結算一段離線時間，直接修改 state 並回傳結算摘要（給結算卡片用）
export function settleOffline(state, seconds) {
  if (state.monster && state.monster.boss) state.monster = null; // 離線不打首領
  const fromZone = state.zone;
  const startLevel = state.level;
  const { zone: zoneId, killsPerSec } = pickZone(state);
  state.zone = zoneId;
  state.monster = null;

  const zone = CONFIG.zones[zoneId - 1];
  const kills = Math.floor(killsPerSec * seconds);
  const s = computeStats(state);
  const em = CONFIG.monster;
  const eliteKills = Math.round(kills * em.eliteChance);
  const normalKills = kills - eliteKills;

  const exp = (normalKills + eliteKills * em.eliteRewardMult) * zone.exp;
  const killGold = (normalKills + eliteKills * em.eliteRewardMult) * zone.gold;

  // 掉寶件數：數量少時逐隻抽，數量大時用期望值估算
  const d = CONFIG.drops;
  let drops;
  if (kills <= 20000) {
    drops = 0;
    for (let i = 0; i < normalKills; i++) if (Math.random() < d.normalChance) drops++;
    for (let i = 0; i < eliteKills; i++) if (Math.random() < d.eliteChance) drops++;
  } else {
    drops = Math.round(normalKills * d.normalChance + eliteKills * d.eliteChance);
  }

  // 逐件決定稀有度，並把擊殺平均分配到每件之間來推進保底計數
  const killsPerDrop = drops > 0 ? kills / drops : 0;
  let pityCounter = state.killsSinceLegend;
  let decomposeGold = 0;
  let legendGold = 0;
  let decomposed = 0;
  const kept = [];
  const legends = [];
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < drops; i++) {
    pityCounter += killsPerDrop;
    let rarity = pityCounter >= d.pityKills ? 3 : rollRarity(s.loot);
    counts[rarity]++;
    if (rarity === 3) {
      pityCounter = 0;
      const slot = CONFIG.legendaries[Math.floor(Math.random() * CONFIG.legendaries.length)].slot;
      const item = makeItem(state, zoneId, 3, slot);
      const res = storeItem(state, item);
      state.stats.legends++;
      if (res.kept) legends.push(item);
      else { legendGold += res.gold; decomposed++; }   // storeItem 已把金幣加進去
      continue;
    }
    const rar = CONFIG.rarities[rarity];
    const willKeep = rarity >= state.autoDecompose && state.bag.length < CONFIG.bagSize;
    if (willKeep) {
      const item = makeItem(state, zoneId, rarity);
      storeItem(state, item);
      kept.push(item);
    } else {
      decomposeGold += zone.gold * rar.decompose;
      decomposed++;
    }
  }
  state.killsSinceLegend = Math.floor(pityCounter + (kills - drops * killsPerDrop));

  state.exp += exp;
  state.gold += killGold + decomposeGold;
  state.stats.kills += kills;
  const levelLogStart = state.log.length;
  levelUp(state, {});
  state.log.splice(levelLogStart);  // 升級訊息改由結算卡片呈現
  state.hp = computeStats(state).hp;

  const summary = {
    seconds,
    fromZone,
    zone: zoneId,
    kills,
    exp,
    gold: killGold + decomposeGold + legendGold,
    decomposed,
    decomposeGold: decomposeGold + legendGold,
    levels: state.level - startLevel,
    kept,
    legends,
    counts,
  };
  addLog(state, `離線結算：${formatDuration(seconds)}，擊敗 ${kills.toLocaleString()} 隻，獲得 ${summary.gold.toLocaleString()} 金幣`, 'good', true);
  return summary;
}

export function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} 天`);
  if (h) parts.push(`${h} 小時`);
  if (m || !parts.length) parts.push(`${m} 分鐘`);
  return parts.join(' ');
}
