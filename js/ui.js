import { CONFIG, STAT_NAMES, PERCENT_STATS } from './config.js';
import {
  computeStats, expToNext, skillPointsFree, learnBlocker, learnSkill, resetSkills,
} from './state.js';
import { decomposeValue, enhanceCost, enhanceItem } from './loot.js';

const $ = sel => document.querySelector(sel);
const STAT_ORDER = ['atk', 'hp', 'def', 'crit', 'loot'];
const SLOT_ORDER = Object.fromEntries(CONFIG.slots.map((s, i) => [s.id, i]));

let state = null;
let selected = null;        // { from: 'bag' | 'equip', id }
let importantOnly = false;
let skillsOpen = false;
let toastTimer = null;
let onChange = () => {};

export function fmtStat(stat, v) {
  if (PERCENT_STATS.has(stat)) return (Math.round(v * 1000) / 10).toFixed(1) + '%';
  if (stat === 'hp') return Math.round(v).toLocaleString();
  return (Math.round(v * 10) / 10).toString();
}

function slotOf(id) { return CONFIG.slots.find(s => s.id === id); }
function mainValue(item, enh = item.enh || 0) { return item.main * (1 + CONFIG.enhance.perLevel * enh); }

function itemLabel(item) {
  const rar = CONFIG.rarities[item.rarity];
  const enh = item.enh ? ` +${item.enh}` : '';
  return `<span class="r${item.rarity}">${slotOf(item.slot).icon} [${rar.name}] ${item.name}${enh}</span>`;
}

function itemSummary(item) {
  const slot = slotOf(item.slot);
  return `${STAT_NAMES[slot.stat]} ${fmtStat(slot.stat, mainValue(item))}` + (item.affixes.length ? ` · ${item.affixes.length} 詞綴` : '');
}

function bar(cur, max, cls) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return `<div class="bar ${cls}"><div style="width:${pct}%"></div></div>`;
}

// 內容沒變就不重建，避免點擊時元素剛好被換掉
function setHTML(el, html) {
  if (el._html === html) return;
  el.innerHTML = html;
  el._html = html;
}

function findItem(sel) {
  if (!sel) return null;
  if (sel.from === 'bag') return state.bag.find(i => i.id === sel.id) || null;
  return Object.values(state.equipped).find(i => i && i.id === sel.id) || null;
}

// ---------- 頁面內的二次確認：3 秒內再按一次才執行 ----------
let armed = null;   // { act, id, until }
function isArmed(act, id) {
  return armed && armed.act === act && armed.id === id && Date.now() < armed.until;
}
function arm(act, id) {
  if (isArmed(act, id)) { armed = null; return true; }
  armed = { act, id, until: Date.now() + 3000 };
  return false;
}

// ---------- 左欄：角色 ----------
function renderChar() {
  const s = computeStats(state);
  const need = expToNext(state.level);
  const hpLow = state.hp < s.hp * 0.3 ? ' low' : '';
  const free = skillPointsFree(state);
  const html = `
    <h2>角色</h2>
    <div class="row"><span>等級</span><b class="num">Lv ${state.level}${state.level >= CONFIG.player.levelCap ? '（滿級）' : ''}</b></div>
    ${need ? bar(state.exp, need, 'exp') + `<div class="sub num">${Math.floor(state.exp).toLocaleString()} / ${need.toLocaleString()} 經驗</div>` : ''}
    <div class="row"><span>生命</span><b class="num">${Math.max(0, Math.round(state.hp)).toLocaleString()} / ${s.hp.toLocaleString()}</b></div>
    ${bar(state.hp, s.hp, 'hp' + hpLow)}
    <div class="row"><span>攻擊</span><b class="num">${fmtStat('atk', s.atk)}</b></div>
    <div class="row"><span>防禦</span><b class="num">${fmtStat('def', s.def)}</b></div>
    <div class="row"><span>暴擊率</span><b class="num">${fmtStat('crit', s.crit)}</b></div>
    <div class="row"><span>掉寶率</span><b class="num">${fmtStat('loot', s.loot)}</b></div>
    <div class="row"><span>🪙 金幣</span><b class="num gold">${Math.floor(state.gold).toLocaleString()}</b></div>
    <button class="skill-btn${free > 0 ? ' has-points' : ''}" data-ui="openSkills">
      技能樹${free > 0 ? `<span class="badge">${free} 點未分配</span>` : ''}
    </button>`;
  setHTML($('#charStats'), html);

  let eq = '';
  for (const slot of CONFIG.slots) {
    const it = state.equipped[slot.id];
    const sel = selected && it && selected.id === it.id ? ' selected' : '';
    eq += it
      ? `<li class="item${sel}" data-from="equip" data-id="${it.id}" tabindex="0">${itemLabel(it)}<span class="sub">${itemSummary(it)}</span></li>`
      : `<li class="item empty">${slot.icon} ${slot.name}：（空）</li>`;
  }
  setHTML($('#equipList'), eq);
}

// ---------- 中欄：戰鬥 ----------
function renderBattle() {
  const zone = CONFIG.zones[state.zone - 1];
  const m = state.monster;
  setHTML($('#zone'), `${zone.icon} 第 ${zone.id} 區　${zone.name}`);
  setHTML($('#monster'), m
    ? `<div class="row"><b class="${m.elite ? 'elite' : ''}">${zone.icon} ${m.name}</b><span class="num">${Math.max(0, Math.round(m.hp))} / ${m.maxHp}</span></div>${bar(m.hp, m.maxHp, 'mon')}`
    : `<div class="sub">尋找下一隻怪物……</div>${bar(0, 1, 'mon')}`);
  const lines = state.log.filter(l => !importantOnly || l.important).slice(-CONFIG.logLines).reverse();
  setHTML($('#log'), lines.map(l => {
    const r = l.rarity !== undefined ? ` r${l.rarity}` : '';
    return `<li class="log-${l.kind}${r}">${l.text}</li>`;
  }).join(''));
}

// ---------- 右欄：背包 ----------
const SORTERS = {
  rarity: (a, b) => b.rarity - a.rarity || b.zone - a.zone || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot],
  slot:   (a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || b.rarity - a.rarity || b.zone - a.zone,
  zone:   (a, b) => b.zone - a.zone || b.rarity - a.rarity || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot],
};

function renderBag() {
  const count = `${state.bag.length} / ${CONFIG.bagSize}`;
  setHTML($('#bagCount'), state.bag.length > CONFIG.bagSize ? `<span class="down">${count}</span>` : count);
  $('#autoDecompose').value = String(state.autoDecompose);
  $('#bagSort').value = state.bagSort;
  const full = state.bag.length >= CONFIG.bagSize;
  const hint = $('#bagHint');
  hint.hidden = !full;
  setHTML(hint, full ? '背包滿了，新的掉寶會直接分解成金幣（傳說除外）。可以整理背包，或設定自動分解。' : '');
  const sorted = [...state.bag].sort(SORTERS[state.bagSort] || SORTERS.rarity);
  setHTML($('#bagList'), sorted.length
    ? sorted.map(it => {
        const sel = selected && selected.from === 'bag' && selected.id === it.id ? ' selected' : '';
        return `<li class="item${sel}" data-from="bag" data-id="${it.id}" tabindex="0">${itemLabel(it)}<span class="sub">${itemSummary(it)}</span></li>`;
      }).join('')
    : '<li class="sub">背包是空的，繼續刷吧！</li>');
  renderDetail();
}

function enhanceButton(item) {
  const cost = enhanceCost(item);
  if (cost === null) return `<button disabled>已強化到 +${CONFIG.enhance.maxLevel}</button>`;
  const short = state.gold < cost;
  return `<button data-act="enhance"${short ? ' disabled' : ''}>強化到 +${(item.enh || 0) + 1}（🪙 ${cost.toLocaleString()}${short ? '，金幣不足' : ''}）</button>`;
}

function renderDetail() {
  const item = findItem(selected);
  const box = $('#detail');
  if (!item) { box.hidden = true; setHTML(box, ''); return; }
  box.hidden = false;
  const slot = slotOf(item.slot);
  const zone = CONFIG.zones[item.zone - 1];
  const canEnh = (item.enh || 0) < CONFIG.enhance.maxLevel;
  const nextMain = canEnh
    ? ` <span class="sub">→ 強化後 ${fmtStat(slot.stat, mainValue(item, (item.enh || 0) + 1))}</span>`
    : '';
  let html = `<div class="detail-title">${itemLabel(item)}</div>
    <div class="sub">${slot.name} · 來自${zone.name}${selected.from === 'equip' ? ' · 穿在身上' : ''}</div>
    <ul class="affixes">
      <li><b>${STAT_NAMES[slot.stat]} ${fmtStat(slot.stat, mainValue(item))}</b>（主屬性）${nextMain}</li>
      ${item.affixes.map(a => `<li>${STAT_NAMES[a.stat]} +${fmtStat(a.stat, a.value)}</li>`).join('')}
    </ul>`;
  if (item.legend) {
    const l = CONFIG.legendaries.find(x => x.slot === item.slot);
    html += `<div class="legend-effect">特殊效果：${l.desc}</div>`;
  }
  if (selected.from === 'bag') {
    const cur = computeStats(state);
    const next = computeStats(state, { slot: item.slot, item });
    const diffs = STAT_ORDER.map(k => {
      const d = next[k] - cur[k];
      if (Math.abs(d) < 1e-9) return '';
      const cls = d > 0 ? 'up' : 'down';
      const sign = d > 0 ? '+' : '−';
      return `<li class="${cls}">${STAT_NAMES[k]} ${sign}${fmtStat(k, Math.abs(d))}</li>`;
    }).join('');
    const equipped = state.equipped[item.slot];
    html += `<div class="compare"><div class="sub">換上後${equipped ? `（取代 ${equipped.name}${equipped.enh ? ' +' + equipped.enh : ''}）` : ''}：</div>
      <ul>${diffs || '<li class="sub">數值沒有變化</li>'}</ul></div>
      <div class="actions">
        <button data-act="equip" class="primary">穿上</button>
        ${enhanceButton(item)}
        ${isArmed('decompose', item.id)
          ? `<button data-act="decompose" class="warn">再按一次確認分解</button>`
          : `<button data-act="decompose" class="ghost">分解（+${decomposeValue(item)} 金幣）</button>`}
      </div>`;
    if (item.enh) html += '<div class="sub">分解不會退還強化花費的金幣。</div>';
  } else {
    html += `<div class="actions">${enhanceButton(item)}</div>`;
  }
  setHTML(box, html);
}

// ---------- 技能樹 ----------
function renderSkills() {
  const box = $('#skills');
  box.hidden = !skillsOpen;
  if (!skillsOpen) return;
  const free = skillPointsFree(state);
  const max = CONFIG.skills.maxLevel;
  let html = `<div class="skills-panel" role="dialog" aria-modal="true" aria-label="技能樹"><div class="skills-head">
      <h2>技能樹</h2>
      <span class="num">剩餘技能點 <b class="${free > 0 ? 'up' : ''}">${free}</b></span>
      <button data-ui="resetSkills" class="ghost">重置技能點</button>
      <button data-ui="closeSkills" aria-label="關閉技能樹">關閉</button>
    </div>
    <p class="sub">每升一級得到 1 點。技能都是被動的，學了就一直生效。重置免費，點數會全部退回。</p>
    <div class="branches">`;
  for (const b of CONFIG.skills.branches) {
    html += `<div class="branch"><h3>${b.name}</h3>`;
    b.skills.forEach((sk, i) => {
      const lv = state.skills[sk.id] || 0;
      const blocker = learnBlocker(state, sk.id);
      const locked = i > 0 && (state.skills[b.skills[0].id] || 0) < CONFIG.skills.unlockAt;
      html += `<div class="skill${locked ? ' locked' : ''}">
        <div class="row"><b>${sk.name}</b><span class="num">Lv ${lv} / ${max}</span></div>
        <div class="pips">${Array.from({ length: max }, (_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</div>
        <div class="sub">目前：${lv ? sk.text(sk.per * lv) : '尚未學習'}</div>
        ${lv < max ? `<div class="sub">下一級：${sk.text(sk.per * (lv + 1))}</div>` : ''}
        ${locked ? `<div class="sub lock">需要${b.skills[0].name} ${CONFIG.skills.unlockAt} 級</div>` : ''}
        <button data-skill="${sk.id}"${blocker ? ' disabled' : ''}>${lv >= max ? '已學滿' : '學習 +1'}</button>
      </div>`;
    });
    html += '</div>';
  }
  html += '</div></div>';
  setHTML(box, html);
}

export function render() {
  renderChar();
  renderBattle();
  renderBag();
  renderSkills();
}

// ---------- 提示條 ----------
export function showLegendToast(item) {
  const t = $('#toast');
  t.innerHTML = `⭐ 掉落傳說：<b>${item.name}</b>　點這裡查看`;
  t.hidden = false;
  t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
  t.onclick = () => { selected = { from: 'bag', id: item.id }; t.hidden = true; render(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

// ---------- 操作 ----------
function keepHpRatio(fn) {
  const before = computeStats(state);
  const ratio = state.hp / before.hp;
  fn();
  const after = computeStats(state);
  state.hp = Math.min(after.hp, Math.max(1, ratio * after.hp));
}

function equip(item) {
  keepHpRatio(() => {
    state.bag = state.bag.filter(i => i.id !== item.id);
    const old = state.equipped[item.slot];
    state.equipped[item.slot] = item;
    if (old) state.bag.push(old);
  });
  selected = { from: 'equip', id: item.id };
}

function decompose(item) {
  if (item.rarity >= 2 && !arm('decompose', item.id)) return;
  state.gold += decomposeValue(item);
  state.bag = state.bag.filter(i => i.id !== item.id);
  selected = null;
}

function handleClick(e) {
  const li = e.target.closest('li.item[data-id]');
  if (li) {
    const id = Number(li.dataset.id);
    selected = selected && selected.id === id ? null : { from: li.dataset.from, id };
    render();
    return;
  }

  const ui = e.target.closest('[data-ui]');
  if (ui) {
    const what = ui.dataset.ui;
    if (what === 'openSkills') skillsOpen = true;
    if (what === 'closeSkills') skillsOpen = false;
    if (what === 'resetSkills') { keepHpRatio(() => resetSkills(state)); onChange(); }
    render();
    if (what === 'openSkills') $('#skills button[data-ui="closeSkills"]')?.focus();
    return;
  }

  const skillBtn = e.target.closest('button[data-skill]');
  if (skillBtn) {
    keepHpRatio(() => learnSkill(state, skillBtn.dataset.skill));
    onChange();
    render();
    return;
  }

  const btn = e.target.closest('button[data-act]');
  if (btn) {
    const item = findItem(selected);
    if (!item) return;
    if (btn.dataset.act === 'equip') equip(item);
    if (btn.dataset.act === 'decompose') decompose(item);
    if (btn.dataset.act === 'enhance') keepHpRatio(() => enhanceItem(state, item));
    onChange();
    render();
  }
}

export function initUI(s, changeHandler) {
  state = s;
  onChange = changeHandler;

  document.body.addEventListener('click', handleClick);

  document.body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('li.item[data-id]')) e.target.click();
    if (e.key === 'Escape' && skillsOpen) { skillsOpen = false; render(); }
  });

  // 點技能樹外面的半透明區域也能關閉
  $('#skills').addEventListener('click', e => {
    if (e.target.id === 'skills') { skillsOpen = false; render(); }
  });

  $('#autoDecompose').addEventListener('change', e => {
    state.autoDecompose = Number(e.target.value);
    onChange();
  });

  $('#bagSort').addEventListener('change', e => {
    state.bagSort = e.target.value;
    onChange();
    render();
  });

  $('#importantOnly').addEventListener('change', e => {
    importantOnly = e.target.checked;
    renderBattle();
  });
}

export function setState(s) { state = s; selected = null; }
