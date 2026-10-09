import { CONFIG } from './config.js';
import { computeStats, expToNext } from './state.js';
import { rollDrop, storeItem } from './loot.js';

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
    atk: zone.atk * type.atk * m,
    def: zone.def * type.def * m,
    hp,
    maxHp: hp,
  };
}

function levelUp(state, events) {
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
    const zone = CONFIG.zones[state.zone - 1];
    const r = mon.elite ? CONFIG.monster.eliteRewardMult : 1;
    const exp = zone.exp * r;
    const gold = zone.gold * r;
    state.exp += exp;
    state.gold += gold;
    state.stats.kills++;
    addLog(state, `擊敗 ${mon.name}！獲得 ${exp} 經驗、${gold} 金幣`, 'kill', true);
    if (s.effects.has('killHeal')) state.hp = Math.min(s.hp, state.hp + s.hp * 0.05);

    const item = rollDrop(state, state.zone, mon.elite, s.loot);
    if (item) {
      const res = storeItem(state, item);
      const rar = CONFIG.rarities[item.rarity].name;
      if (item.legend) {
        state.stats.legends++;
        events.legend = item;
        addLog(state, `掉落傳說：${item.name}！`, 'legend', true, { rarity: 3 });
      } else if (res.kept) {
        addLog(state, `掉落：[${rar}] ${item.name}`, 'drop', true, { rarity: item.rarity });
      } else {
        const why = res.reason === 'full' ? '背包已滿，' : '';
        addLog(state, `${why}自動分解 [${rar}] ${item.name}，獲得 ${res.gold} 金幣`, 'decompose', true, { rarity: item.rarity });
      }
    }
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
    state.stats.deaths++;
    const from = CONFIG.zones[state.zone - 1].name;
    if (state.zone > 1) {
      state.zone--;
      addLog(state, `你倒下了……被送回 ${CONFIG.zones[state.zone - 1].name}（原本在 ${from}）`, 'bad', true);
    } else {
      addLog(state, `你倒下了……在 ${from} 休息一下再出發`, 'bad', true);
    }
    state.hp = s.hp;
    state.monster = null;
    events.death = true;
  }
  return events;
}
