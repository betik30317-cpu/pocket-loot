// 所有數值集中在這裡，對應企劃文件「07 數值表」。
// 調整數值時先在數值表確認節奏，再改這裡，不需要動其他程式。

export const CONFIG = {
  version: 1,

  // 角色（07 數值表：參數、角色成長）
  player: {
    atkBase: 10, atkPerLevel: 2,
    hpBase: 100, hpPerLevel: 20,
    defBase: 2, defPerLevel: 1,
    critBase: 0.05,
    regenPerSec: 0.01,      // 佔生命上限
    levelCap: 20,
    expCoef: 100,           // 升到下一級所需經驗 = 係數 × 等級²
    critMult: 2,
    critCap: 0.75,
    lootFindCap: 1,
  },

  monster: {
    critRate: 0.05,
    eliteChance: 0.05,
    eliteStatMult: 2,
    eliteRewardMult: 3,
    bossHpMult: 6, bossAtkMult: 2.2, bossDefMult: 1.2,
    bossRewardMult: 20,
  },

  // 一般怪類型倍率（06）
  monsterTypes: [
    { id: 'avg',   name: '平均型', atk: 1,   hp: 1,   def: 1 },
    { id: 'tank',  name: '肉盾型', atk: 0.7, hp: 1.5, def: 1.5 },
    { id: 'burst', name: '猛攻型', atk: 1.5, hp: 0.6, def: 0.7 },
  ],

  // 五個區域（06、07）
  zones: [
    { id: 1, name: '果凍草原', icon: '🍮', adj: '果凍', atk: 6,  hp: 40,  def: 1,  exp: 3,   gold: 3,  gearMult: 1,
      monsters: ['跳跳果凍', '蘑菇寶寶', '蜜蜂兵'], boss: '大果凍王', bossLegend: null },
    { id: 2, name: '瞌睡森林', icon: '🌙', adj: '瞌睡', atk: 12, hp: 90,  def: 4,  exp: 13,  gold: 7,  gearMult: 2,
      monsters: ['打呵欠松鼠', '樹樁先生', '夜貓頭鷹'], boss: '枕頭熊', bossLegend: 'hat' },
    { id: 3, name: '恐龍谷',   icon: '🦖', adj: '恐龍', atk: 21, hp: 170, def: 8,  exp: 42,  gold: 14, gearMult: 3.2,
      monsters: ['蛋殼小龍', '甲甲龍', '迅猛雞'], boss: '暴龍寶寶', bossLegend: 'armor' },
    { id: 4, name: '糖果城堡', icon: '🍭', adj: '糖果', atk: 29, hp: 250, def: 12, exp: 75,  gold: 25, gearMult: 4.6,
      monsters: ['薑餅士兵', '布丁衛兵', '跳跳糖騎士'], boss: '糖果國王', bossLegend: 'weapon' },
    { id: 5, name: '幸運雲端', icon: '🌈', adj: '彩虹', atk: 39, hp: 340, def: 16, exp: 106, gold: 40, gearMult: 6.2,
      monsters: ['雲朵羊', '星星龜', '閃電小鳥'], boss: '彩虹龍', bossLegend: 'accessory' },
  ],

  // 掉落（05）
  drops: {
    normalChance: 0.2,
    eliteChance: 0.4,
    rarityChance: [0.7, 0.22, 0.075, 0.005], // 普通、魔法、稀有、傳說
    pityKills: 1500,
  },

  // 稀有度（04、09）
  rarities: [
    { id: 0, name: '普通', color: '#F2F2F2', mainMult: 1,    affixes: 0, decompose: 2 },
    { id: 1, name: '魔法', color: '#5AA9FF', mainMult: 1.15, affixes: 1, decompose: 5 },
    { id: 2, name: '稀有', color: '#B57CFF', mainMult: 1.3,  affixes: 2, decompose: 15 },
    { id: 3, name: '傳說', color: '#FF9F43', mainMult: 1.5,  affixes: 3, decompose: 50 },
  ],

  // 裝備欄位（04、07）。飾品暴擊率不乘區域倍率，每區固定增加。
  slots: [
    { id: 'weapon',    name: '武器', icon: '🗡️', noun: '小劍', stat: 'atk',  base: 4 },
    { id: 'hat',       name: '帽子', icon: '🎩', noun: '帽子', stat: 'def',  base: 2 },
    { id: 'armor',     name: '衣服', icon: '👕', noun: '衣服', stat: 'hp',   base: 30 },
    { id: 'accessory', name: '飾品', icon: '💍', noun: '戒指', stat: 'crit', base: 0.02, perZone: 0.01 },
  ],
  mainRoll: [0.9, 1.1],

  // 詞綴（07）：攻擊、生命、防禦乘區域倍率；暴擊率、掉寶率每區固定增加
  affixes: [
    { stat: 'atk',  base: 2 },
    { stat: 'hp',   base: 15 },
    { stat: 'def',  base: 1 },
    { stat: 'crit', base: 0.01, perZone: 0.005 },
    { stat: 'loot', base: 0.05, perZone: 0.025 },
  ],
  affixMinRoll: 0.5,

  // 傳說裝備（04）
  legendaries: [
    { slot: 'weapon',    name: '棒棒糖之劍', effect: 'critHeal',     desc: '暴擊時回復 3% 生命' },
    { slot: 'hat',       name: '軟綿綿睡帽', effect: 'lowHpDefense', desc: '生命低於 30% 時，防禦提高 50%' },
    { slot: 'armor',     name: '恐龍連身裝', effect: 'killHeal',     desc: '每擊敗一隻怪物，回復 5% 生命' },
    { slot: 'accessory', name: '四葉草手環', effect: 'bigCrit',      desc: '暴擊傷害由 2 倍提高為 3 倍' },
  ],

  // 強化（07），里程碑 2 使用
  enhance: { perLevel: 0.1, maxLevel: 5, costCoef: [20, 40, 80, 160, 320] },

  bagSize: 30,
  logLines: 50,
};

export const STAT_NAMES = { atk: '攻擊', hp: '生命', def: '防禦', crit: '暴擊率', loot: '掉寶率' };
export const PERCENT_STATS = new Set(['crit', 'loot']);
