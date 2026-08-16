/* ============================================================
   Hockey.AI — Shared App Utilities
   FIH Hockey World Cup 2026
   ============================================================ */

// ── Data cache ─────────────────────────────────
const _cache = {};

async function loadJSON(path) {
  if (_cache[path]) return _cache[path];
  try {
    const r = await fetch(path + '?v=' + Date.now());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _cache[path] = data;
    return data;
  } catch (e) {
    console.warn('loadJSON failed:', path, e);
    return null;
  }
}

// ── Team helpers ────────────────────────────────
let _teams = null;
async function getTeams() {
  if (_teams) return _teams;
  const d = await loadJSON('/data/teams.json');
  _teams = d ? d.teams : [];
  return _teams;
}
async function getTeamByCode(code) {
  const teams = await getTeams();
  return teams.find(t => t.code === code) || { code, name: code, flag: '🏑', color: '#ffb547' };
}

// ── Date + time helpers ─────────────────────────
function formatMatchDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function formatMatchTime(timeStr, tz = 'CET') {
  return timeStr + ' ' + tz;
}
function isToday(dateStr) {
  const today = new Date();
  const d = new Date(dateStr + 'T00:00:00');
  return d.toDateString() === today.toDateString();
}
function isPast(dateStr) {
  const d = new Date(dateStr + 'T23:59:59');
  return d < new Date();
}
function isFuture(dateStr, timeStr) {
  const dt = new Date(dateStr + 'T' + timeStr + ':00');
  return dt > new Date();
}
function relativeTime(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const diff = d - now;
  const days = Math.round(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return Math.abs(days) + 'd ago';
  return 'In ' + days + 'd';
}

// ── Score display ───────────────────────────────
function renderScore(match) {
  const s = match.score;
  if (match.status === 'live') {
    const homeScore = s.home !== null ? s.home : 0;
    const awayScore = s.away !== null ? s.away : 0;
    return `<span style="color:var(--live)">${homeScore}</span><span class="score-sep">–</span><span style="color:var(--live)">${awayScore}</span>`;
  }
  if (match.status === 'completed' && s.home !== null && s.away !== null) {
    return `${s.home}<span class="score-sep">–</span>${s.away}`;
  }
  return `<span class="score-pending">${formatMatchTime(match.time, match.timezone)}</span>`;
}

// ── Status badge ────────────────────────────────
function statusBadge(status, phase) {
  if (status === 'live') {
    return `<span class="badge badge-live"><span class="live-dot"></span>LIVE</span>`;
  }
  if (status === 'completed') {
    return `<span class="badge badge-completed">FT</span>`;
  }
  if (isToday(phase)) {
    return `<span class="badge badge-upcoming">Today</span>`;
  }
  return `<span class="badge badge-scheduled">Scheduled</span>`;
}

// ── Phase label ─────────────────────────────────
function phaseLabel(match) {
  const labels = {
    'pool':         `Pool ${match.pool}`,
    'quarter-final':'Quarter-Final',
    'semi-final':   'Semi-Final',
    'bronze-final': 'Bronze Medal',
    'gold-final':   '🥇 Gold Final',
  };
  return labels[match.phase] || match.phase;
}

// ── Match card HTML ─────────────────────────────
async function buildMatchCard(match, teams) {
  const home = teams.find(t => t.code === match.home) || { code: match.home, name: match.home, flag: '🏑', fih_rank: null };
  const away = teams.find(t => t.code === match.away) || { code: match.away, name: match.away, flag: '🏑', fih_rank: null };

  const isTBD = match.home === 'TBD' || match.away === 'TBD';
  const pcHome = match.penalty_corners?.home;
  const pcAway = match.penalty_corners?.away;

  return `
    <div class="match-card ${match.status}" data-id="${match.id}">
      <div class="match-meta">
        <span class="match-phase-badge">${phaseLabel(match)}</span>
        ${statusBadge(match.status, match.date)}
        <span>${isTBD ? '' : formatMatchDate(match.date)} · ${match.venue === 'AMV' ? 'Amstelveen' : 'Brussels'}</span>
      </div>
      <div class="match-body">
        <div class="match-team home">
          <span class="team-flag">${isTBD ? '🏑' : home.flag}</span>
          <span class="team-name">${isTBD ? (match.label?.split('vs')[0]?.trim() || 'TBD') : home.name}</span>
          ${home.fih_rank ? `<span class="team-rank">FIH #${home.fih_rank}</span>` : ''}
        </div>
        <div class="match-score">
          <div class="score-display font-mono">${renderScore(match)}</div>
          ${match.status === 'live' ? `<div class="score-time text-live font-mono">⏱ LIVE</div>` : ''}
        </div>
        <div class="match-team away">
          <span class="team-flag">${isTBD ? '🏑' : away.flag}</span>
          <span class="team-name">${isTBD ? (match.label?.split('vs')[1]?.trim() || 'TBD') : away.name}</span>
          ${away.fih_rank ? `<span class="team-rank">FIH #${away.fih_rank}</span>` : ''}
        </div>
      </div>
      ${(match.status === 'completed' || match.status === 'live') && !isTBD ? `
      <div class="match-footer">
        ${pcHome !== null && pcHome !== undefined ? `
        <span class="pc-stat">🔴 PC: <strong>${pcHome}</strong></span>
        <span style="color:var(--text-muted)">vs</span>
        <span class="pc-stat">PC: <strong>${pcAway}</strong> 🔴</span>
        ` : `<span></span>`}
      </div>` : ''}
    </div>
  `;
}

// ── Standings row ────────────────────────────────
function buildStandingRow(entry, teams, rank) {
  const team = teams.find(t => t.code === entry.team) || { name: entry.team, flag: '🏑', fih_rank: null };
  const qualClass = rank <= 2 ? 'qualified-direct' : '';
  return `
    <tr class="${qualClass}">
      <td><div class="standing-team">
        <span class="standing-rank">${rank}</span>
        <span>${team.flag}</span>
        <span class="font-bold">${team.name}</span>
        ${team.host ? '<span class="text-xs text-muted">(H)</span>' : ''}
      </div></td>
      <td class="num">${entry.played}</td>
      <td class="num">${entry.won}</td>
      <td class="num">${entry.drawn}</td>
      <td class="num">${entry.lost}</td>
      <td class="num">${entry.gf}</td>
      <td class="num">${entry.ga}</td>
      <td class="num">${entry.gd >= 0 ? '+' : ''}${entry.gd}</td>
      <td class="pts">${entry.points}</td>
    </tr>
  `;
}

// ── Pool standings table ─────────────────────────
function buildStandingsTable(poolData, teams) {
  const sorted = [...poolData].sort((a, b) =>
    b.points - a.points || b.gd - a.gd || b.gf - a.gf
  );
  return `
    <table class="standings-table">
      <thead>
        <tr>
          <th>Team</th>
          <th>P</th><th>W</th><th>D</th><th>L</th>
          <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map((entry, i) => buildStandingRow(entry, teams, i + 1)).join('')}
      </tbody>
    </table>
    <div class="flex gap-2 mt-2" style="font-size:0.68rem;color:var(--text-muted)">
      <span style="width:8px;height:8px;background:var(--live);border-radius:2px;display:inline-block;margin-top:2px"></span> Qualify to QF &nbsp;&nbsp;
      <span style="width:8px;height:8px;background:var(--accent);border-radius:2px;display:inline-block;margin-top:2px"></span> Classification
    </div>
  `;
}

// ── Win probability bar ──────────────────────────
function buildWinProbBar(team, rank) {
  const tiers = {
    'favourite':   { label: '⭐ Favourite',   cls: 'tier-favourite' },
    'contender':   { label: '🔥 Contender',   cls: 'tier-contender' },
    'dark_horse':  { label: '🐎 Dark Horse',  cls: 'tier-dark_horse' },
    'challenger':  { label: 'Challenger',     cls: 'tier-challenger' },
    'outsider':    { label: 'Outsider',       cls: 'tier-outsider' },
  };
  const tier = tiers[team.contender_tier] || tiers.outsider;
  return `
    <div class="win-prob-card">
      <div class="win-prob-flag">${team.flag}</div>
      <div class="win-prob-info">
        <div class="win-prob-name">${team.name}</div>
        <div class="win-prob-rank font-mono">FIH #${team.fih_rank} · Pool ${team.pool}</div>
        <span class="tier-badge ${tier.cls}">${tier.label}</span>
      </div>
      <div class="win-prob-bar-wrap">
        <div class="win-prob-bar">
          <div class="win-prob-fill" style="width:${Math.min(100, team.win_prob * 3.5)}%"></div>
        </div>
        <div class="win-prob-pct">${team.win_prob}%</div>
      </div>
    </div>
  `;
}

// ── Bottom nav active state ──────────────────────
function setActiveNav() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const map = {
    '/':           'nav-home',
    '/matches':    'nav-matches',
    '/teams':      'nav-teams',
    '/players':    'nav-players',
    '/tournament': 'nav-tournament',
    '/oracle':     'nav-oracle',
    '/ai-lab':     'nav-ai-lab',
  };
  const activeId = Object.entries(map).find(([k]) =>
    k === '/' ? path === '' || path === '/' : path.startsWith(k)
  )?.[1];
  if (activeId) {
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === activeId);
    });
  }
}

// ── Refresh indicator ────────────────────────────
function showRefreshTime(tsStr) {
  const el = document.getElementById('last-updated');
  if (!el || !tsStr) return;
  const d = new Date(tsStr);
  el.textContent = 'Updated ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setActiveNav();
  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
