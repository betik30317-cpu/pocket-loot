import { CONFIG } from './config.js';
import { computeStats, expToNext } from './state.js';
import { rollDrop, rollBossDrop, storeItem } from './loot.js';

const fmt = n => (Math.round(n * 10) / 10).toString();

// important: 是否屬於「重要事件」（擊敗、掉寶、升級、倒下）
export function addLog(state, text, kind = 'info', important = false, extra = {}) {
  state.log.push({ text, kind, important, t: Date.now(), ...extra });
  if (state.log.length > CONFIG.logLines * 4) state.log.splice(0, state.log.length - CONFIG.logLines * 4);
}

export function spawnMonster(state) {
  const zone = CONFIG.zones[state.zone - 1];
  const typeIndex = Math.floor(Math.random() * CONFIG.monsterTypes.length);
  const type = CONFIG.monsterTypes[typeIndex];
  const elite = Math.random() < CONFIG.monster.eliteChance;
  const m = elite ? CONFIG.monster.eliteStatMult : 1;
  const hp = Math.round(zone.hp * type.hp * m);
  state.monster = {
    name: (elite ? '精英' : '') + zone.monsters[typeIndex],
    elite,
    boss: false,
    atk: zone.atk * type.atk * m,
    def: zone.def * type.def * m,
    hp,
    maxHp: hp,
  };
}

// 首領戰：以該區平均型為基準（06、07），角色以滿血開始
export function startBoss(state) {
  const zone = CONFIG.zones[state.zone - 1];
  const b = CONFIG.monster;
  const hp = Math.round(zone.hp * b.bossHpMult);
  state.monster = {
    name: zone.boss,
    elite: false,
    boss: true,
    atk: zone.atk * b.bossAtkMult,
    def: zone.def * b.bossDefMult,
    hp,
    maxHp: hp,
  };
  state.hp = computeStats(state).hp;
  addLog(state, `首領戰開始：${zone.boss}！`, 'boss', true);
}

export function abandonBoss(state) {
  if (!state.monster || !state.monster.boss) return;
  addLog(state, `你離開了和 ${state.monster.name} 的戰鬥`, 'info', true);
  state.monster = null;
}

export function levelUp(state, events = {}) {
  let need = expToNext(state.level);
  while (need > 0 && state.exp >= need) {
    state.exp -= need;
    state.level++;
    state.hp = computeStats(state).hp;
    addLog(state, `升級！現在是 Lv ${state.level}，獲得 1 點技能點`, 'good', true);
    events.levelUp = true;
    need = expToNext(state.level);
  }
  if (need === 0) state.exp = 0;
}

function storeAndLog(state, item, events) {
  const res = storeItem(state, item);
  const rar = CONFIG.rarities[item.rarity].name;
  if (item.legend) state.stats.legends++;
  if (item.legend && res.kept) {
    events.legend = item;
    addLog(state, `掉落傳說：${item.name}！`, 'legend', true, { rarity: 3 });
  } else if (item.legend) {
    addLog(state, `掉落傳說：${item.name}，但背包實在塞不下，分解成 ${res.gold} 金幣`, 'legend', true, { rarity: 3 });
  } else if (res.kept) {
    addLog(state, `掉落：[${rar}] ${item.name}`, 'drop', true, { rarity: item.rarity });
  } else {
    const why = res.reason === 'full' ? '背包已滿，' : '';
    addLog(state, `${why}自動分解 [${rar}] ${item.name}，獲得 ${res.gold} 金幣`, 'decompose', true, { rarity: item.rarity });
  }
}

function onBossWin(state, mon, s, events) {
  const zone = CONFIG.zones[state.zone - 1];
  const r = CONFIG.monster.bossRewardMult;
  state.exp += zone.exp * r;
  state.gold += zone.gold * r;
  state.stats.kills++;
  addLog(state, `打倒首領 ${mon.name}！獲得 ${zone.exp * r} 經驗、${zone.gold * r} 金幣`, 'boss', true);
  storeAndLog(state, rollBossDrop(state, state.zone), events);

  const first = !state.bossesDefeated.includes(zone.id);
  if (first) {
    state.bossesDefeated.push(zone.id);
    if (zone.id < CONFIG.zones.length) {
      state.unlockedZone = Math.max(state.unlockedZone, zone.id + 1);
      const next = CONFIG.zones[zone.id];
      addLog(state, `已解鎖下一區：${next.icon} ${next.name}`, 'good', true);
      events.unlocked = next.id;
    } else {
      events.cleared = true;
      state.clearedAt = Date.now();
    }
  }
  levelUp(state, events);
  state.hp = computeStats(state).hp;
  state.monster = null;
}

// 執行一回合（1 秒）。回傳本回合發生的事件，供介面提示使用。
export function tick(state) {
  const events = {};
  if (!state.monster) spawnMonster(state);
  const s = computeStats(state);
  const mon = state.monster;
  if (state.hp > s.hp) state.hp = s.hp;

  // 角色出手；技能「連打」有機率再出手一次
  const critMult = s.effects.has('bigCrit') ? 3 : CONFIG.player.critMult;
  const strike = prefix => {
    const crit = Math.random() < s.crit;
    const dmg = Math.max(1, s.atk - mon.def) * (crit ? critMult : 1);
    mon.hp -= dmg;
    addLog(state, `${prefix}${crit ? '暴擊！' : ''}你對 ${mon.name} 造成 ${fmt(dmg)} 點傷害`, crit ? 'crit' : 'hit');
    if (crit && s.effects.has('critHeal')) state.hp = Math.min(s.hp, state.hp + s.hp * 0.03);
  };
  strike('');
  if (mon.hp > 0 && s.extraHit > 0 && Math.random() < s.extraHit) strike('連打！');

  if (mon.hp <= 0) {
    if (s.effects.has('killHeal')) state.hp = Math.min(s.hp, state.hp + s.hp * 0.05);
    if (mon.boss) { onBossWin(state, mon, s, events); return events; }

    const zone = CONFIG.zones[state.zone - 1];
    const r = mon.elite ? CONFIG.monster.eliteRewardMult : 1;
    const exp = zone.exp * r;
    const gold = zone.gold * r;
    state.exp += exp;
    state.gold += gold;
    state.stats.kills++;
    addLog(state, `擊敗 ${mon.name}！獲得 ${exp} 經驗、${gold} 金幣`, 'kill', true);

    const item = rollDrop(state, state.zone, mon.elite, s.loot);
    if (item) storeAndLog(state, item, events);
    levelUp(state, events);
    state.monster = null;
    return events;
  }

  // 怪物出手
  const mCrit = Math.random() < CONFIG.monster.critRate;
  let def = s.def;
  if (s.effects.has('lowHpDefense') && state.hp < s.hp * 0.3) def *= 1.5;
  const mDmg = Math.max(1, mon.atk - def) * (mCrit ? 2 : 1);
  state.hp -= mDmg;
  addLog(state, `${mon.name} ${mCrit ? '重擊！' : ''}對你造成 ${fmt(mDmg)} 點傷害`, 'hurt');

  // 每秒回復
  state.hp = Math.min(s.hp, state.hp + s.hp * s.regen);

  if (state.hp <= 0) {
    state.hp = s.hp;
    state.monster = null;
    events.death = true;
    // 首領戰失敗：留在原區繼續打一般怪（02）
    if (mon.boss) {
      addLog(state, `被 ${mon.name} 打倒了……再刷一點裝備吧`, 'bad', true);
      events.bossLost = true;
      return events;
    }
    // 一般戰鬥倒下：退回上一區（02）
    state.stats.deaths++;
    const from = CONFIG.zones[state.zone - 1].name;
    if (state.zone > 1) {
      state.zone--;
      addLog(state, `你倒下了……被送回 ${CONFIG.zones[state.zone - 1].name}（原本在 ${from}）`, 'bad', true);
    } else {
      addLog(state, `你倒下了……在 ${from} 休息一下再出發`, 'bad', true);
    }
  }
  return events;
}

export function changeZone(state, zoneId) {
  if (zoneId < 1 || zoneId > state.unlockedZone || zoneId === state.zone) return false;
  state.zone = zoneId;
  state.monster = null;
  const z = CONFIG.zones[zoneId - 1];
  addLog(state, `前往 ${z.icon} ${z.name}`, 'info', true);
  return true;
}
