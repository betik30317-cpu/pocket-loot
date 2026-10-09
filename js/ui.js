import { CONFIG, STAT_NAMES, PERCENT_STATS } from './config.js';
import { computeStats, expToNext } from './state.js';
import { decomposeValue } from './loot.js';

const $ = sel => document.querySelector(sel);
const STAT_ORDER = ['atk', 'hp', 'def', 'crit', 'loot'];

let state = null;
let selected = null;        // { from: 'bag' | 'equip', id }
let importantOnly = false;
let toastTimer = null;
let onChange = () => {};

export function fmtStat(stat, v) {
  if (PERCENT_STATS.has(stat)) return (Math.round(v * 1000) / 10).toFixed(1) + '%';
  if (stat === 'hp') return Math.round(v).toLocaleString();
  return (Math.round(v * 10) / 10).toString();
}

function slotOf(id) { return CONFIG.slots.find(s => s.id === id); }

function itemLabel(item) {
  const rar = CONFIG.rarities[item.rarity];
  const enh = item.enh ? ` +${item.enh}` : '';
  return `<span class="r${item.rarity}">${slotOf(item.slot).icon} [${rar.name}] ${item.name}${enh}</span>`;
}

function itemSummary(item) {
  const slot = slotOf(item.slot);
  const main = item.main * (1 + CONFIG.enhance.perLevel * (item.enh || 0));
  return `${STAT_NAMES[slot.stat]} ${fmtStat(slot.stat, main)}` + (item.affixes.length ? ` · ${item.affixes.length} 詞綴` : '');
}

function bar(cur, max, cls) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return `<div class="bar ${cls}"><div style="width:${pct}%"></div></div>`;
}

function findItem(sel) {
  if (!sel) return null;
  if (sel.from === 'bag') return state.bag.find(i => i.id === sel.id) || null;
  return Object.values(state.equipped).find(i => i && i.id === sel.id) || null;
}

// ---------- 左欄：角色 ----------
function renderChar() {
  const s = computeStats(state);
  const need = expToNext(state.level);
  const hpLow = state.hp < s.hp * 0.3 ? ' low' : '';
  let html = `
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
    <div class="row"><span>技能點</span><b class="num">${state.level - 1}</b></div>
    <p class="sub">技能樹在第二步加入。</p>`;
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

// 內容沒變就不重建，避免點擊時元素剛好被換掉
function setHTML(el, html) {
  if (el._html === html) return;
  el.innerHTML = html;
  el._html = html;
}

// ---------- 中欄：戰鬥 ----------
function renderBattle() {
  const zone = CONFIG.zones[state.zone - 1];
  const m = state.monster;
  $('#zone').innerHTML = `${zone.icon} 第 ${zone.id} 區　${zone.name}`;
  $('#monster').innerHTML = m
    ? `<div class="row"><b class="${m.elite ? 'elite' : ''}">${zone.icon} ${m.name}</b><span class="num">${Math.max(0, Math.round(m.hp))} / ${m.maxHp}</span></div>${bar(m.hp, m.maxHp, 'mon')}`
    : `<div class="sub">尋找下一隻怪物……</div>${bar(0, 1, 'mon')}`;
  const lines = state.log.filter(l => !importantOnly || l.important).slice(-CONFIG.logLines).reverse();
  setHTML($('#log'), lines.map(l => {
    const r = l.rarity !== undefined ? ` r${l.rarity}` : '';
    return `<li class="log-${l.kind}${r}">${l.text}</li>`;
  }).join(''));
}

// ---------- 右欄：背包 ----------
function renderBag() {
  $('#bagCount').textContent = `${state.bag.length} / ${CONFIG.bagSize}`;
  $('#autoDecompose').value = String(state.autoDecompose);
  const sorted = [...state.bag].sort((a, b) => b.rarity - a.rarity || b.zone - a.zone || a.slot.localeCompare(b.slot));
  setHTML($('#bagList'), sorted.length
    ? sorted.map(it => {
        const sel = selected && selected.from === 'bag' && selected.id === it.id ? ' selected' : '';
        return `<li class="item${sel}" data-from="bag" data-id="${it.id}" tabindex="0">${itemLabel(it)}<span class="sub">${itemSummary(it)}</span></li>`;
      }).join('')
    : '<li class="sub">背包是空的，繼續刷吧！</li>');
  renderDetail();
}

function renderDetail() {
  const item = findItem(selected);
  const box = $('#detail');
  if (!item) { box.hidden = true; setHTML(box, ''); return; }
  box.hidden = false;
  const slot = slotOf(item.slot);
  const zone = CONFIG.zones[item.zone - 1];
  const main = item.main * (1 + CONFIG.enhance.perLevel * (item.enh || 0));
  let html = `<div class="detail-title">${itemLabel(item)}</div>
    <div class="sub">${slot.name} · 來自${zone.name}</div>
    <ul class="affixes">
      <li><b>${STAT_NAMES[slot.stat]} ${fmtStat(slot.stat, main)}</b>（主屬性）</li>
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
    html += `<div class="compare"><div class="sub">換上後${equipped ? `（取代 ${equipped.name}）` : ''}：</div>
      <ul>${diffs || '<li class="sub">數值沒有變化</li>'}</ul></div>
      <div class="actions">
        <button data-act="equip">穿上</button>
        ${isArmed('decompose', item.id)
          ? `<button data-act="decompose" class="warn">再按一次確認分解</button>`
          : `<button data-act="decompose" class="ghost">分解（+${decomposeValue(item)} 金幣）</button>`}
      </div>`;
  } else {
    html += '<div class="sub">強化在第二步加入。</div>';
  }
  setHTML(box, html);
}

export function render() {
  renderChar();
  renderBattle();
  renderBag();
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
function equip(item) {
  const before = computeStats(state);
  const hpRatio = state.hp / before.hp;
  state.bag = state.bag.filter(i => i.id !== item.id);
  const old = state.equipped[item.slot];
  state.equipped[item.slot] = item;
  if (old) state.bag.push(old);
  const after = computeStats(state);
  state.hp = Math.min(after.hp, Math.max(1, hpRatio * after.hp));
  selected = { from: 'equip', id: item.id };
}

// 頁面內的二次確認：第一次按下進入「待確認」，3 秒內再按一次才執行
let armed = null;   // { act, id, until }
export function isArmed(act, id) {
  return armed && armed.act === act && armed.id === id && Date.now() < armed.until;
}
export function arm(act, id) {
  if (isArmed(act, id)) { armed = null; return true; }
  armed = { act, id, until: Date.now() + 3000 };
  return false;
}

function decompose(item) {
  if (item.rarity >= 2 && !arm('decompose', item.id)) return;
  state.gold += decomposeValue(item);
  state.bag = state.bag.filter(i => i.id !== item.id);
  selected = null;
}

export function initUI(s, changeHandler) {
  state = s;
  onChange = changeHandler;

  document.body.addEventListener('click', e => {
    const li = e.target.closest('li.item[data-id]');
    if (li) {
      const id = Number(li.dataset.id);
      selected = selected && selected.id === id ? null : { from: li.dataset.from, id };
      render();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      const item = findItem(selected);
      if (!item) return;
      if (btn.dataset.act === 'equip') equip(item);
      if (btn.dataset.act === 'decompose') decompose(item);
      onChange();
      render();
    }
  });

  document.body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('li.item[data-id]')) e.target.click();
  });

  $('#autoDecompose').addEventListener('change', e => {
    state.autoDecompose = Number(e.target.value);
    onChange();
  });

  $('#importantOnly').addEventListener('change', e => {
    importantOnly = e.target.checked;
    renderBattle();
  });
}

export function setState(s) { state = s; selected = null; }
