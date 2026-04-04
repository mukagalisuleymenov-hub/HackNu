// ============================================================
// CONFIG
// ============================================================

const HOST         = location.hostname || 'localhost';
const BACKEND_WS   = `ws://${HOST}:8000/ws/live`;
const BACKEND_HTTP = `http://${HOST}:8000`;

const HEALTH_CATS = {
  A: { label: 'СТАБИЛЬНО',      risk: 'Минимальный', color: '#22c55e' },
  B: { label: 'Хорошо',         risk: 'Низкий',       color: '#84cc16' },
  C: { label: 'ВНИМАНИЕ',       risk: 'Умеренный',    color: '#eab308' },
  D: { label: 'ПРЕДУПРЕЖДЕНИЕ', risk: 'Высокий',      color: '#f97316' },
  E: { label: 'КРИТИЧНО',       risk: 'ВЫСОКИЙ',      color: '#ef4444' },
};

const PARAM_LABELS = {
  traction_motor_temperature:    'Температура ТЭД',
  brake_pipe_pressure:           'Давление ТМ',
  main_reservoir_pressure:       'Давление ГР',
  catenary_voltage:              'Напряжение КС',
  transformer_oil_temperature:   'Темп. трансформатора',
  traction_converter_temperature:'Темп. IGBT-преобр.',
  engine_coolant_temperature:    'Темп. охлаждения',
  engine_oil_pressure:           'Давление масла',
  fuel_level:                    'Уровень топлива',
  exhaust_temperature:           'Темп. выхлопа',
  speed:                         'Скорость',
  traction_motor_current:        'Ток ТЭД',
};

// ============================================================
// STATE
// ============================================================

let isPaused       = false;
let isFailureMode  = false;
let activeCategory = null;
let lastFrame      = null;
let currentLocoType = 'KZ8A';

const WINDOW_SIZE = 60;
const MAX_BUF     = 1200;
let fullTime = [], fullSpeed = [], fullTemp = [], fullPredict = [];
let viewEnd  = 0;

let wsReconnectDelay = 1000;
let ws = null;
let lastMessageTime = null;
let syncTimerId = null;

// Health animation state
let _healthDisplayed = null;
let _healthRafId = null;

// ============================================================
// WEBSOCKET
// ============================================================

function connectWS() {
  ws = new WebSocket(BACKEND_WS);

  ws.onopen = () => {
    wsReconnectDelay = 1000;
    setConnectionStatus(true);
  };

  ws.onmessage = (e) => {
    lastMessageTime = Date.now();
    try {
      const frame = JSON.parse(e.data);
      lastFrame = frame;
      pushChartData(frame);
      if (!isPaused && !isFailureMode) applyFrame(frame);  // ← both gates
    } catch (err) {
      console.warn('[WS] Parse error:', err);
    }
  };

  ws.onclose = () => {
    setConnectionStatus(false);
    setTimeout(connectWS, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
  };

  ws.onerror = () => ws.close();
}

function setConnectionStatus(online) {
  const ping = document.getElementById('ping-indicator');
  const sync = document.getElementById('sync-indicator');
  if (online) {
    ping.textContent = '🟢 Connected';
    ping.style.color = 'var(--status-norm)';
  } else {
    ping.textContent = '🔴 Offline';
    ping.style.color = 'var(--status-crit)';
    if (sync) sync.textContent = 'Reconnecting...';
  }
}

function startSyncTicker() {
  clearInterval(syncTimerId);
  syncTimerId = setInterval(() => {
    const sync = document.getElementById('sync-indicator');
    if (!sync) return;
    if (!lastMessageTime) { sync.textContent = ''; return; }
    const ago = ((Date.now() - lastMessageTime) / 1000).toFixed(1);
    sync.textContent = `${ago}s ago`;
    sync.style.color = ago > 3 ? 'var(--status-warn)' : 'var(--text-muted)';
  }, 500);
}

// ============================================================
// APPLY FRAME → UI
// ============================================================

function applyFrame(frame) {
  if (!frame) return;
  const data = frame.data || {};
  if (frame.locomotive_type) currentLocoType = frame.locomotive_type;

  updateLocoLabel(frame);
  applyHealthIndex(frame.health_index, frame.health_category);
  if (!activeCategory) renderLiveFactors(frame.health_factors || []);
  applySchemaNodes(frame.alerts || [], data);
  applyAlerts(frame.alerts || []);
  applyStatCards(data, currentLocoType);
}

// ---- Loco label (textContent only, never innerHTML) ----
function updateLocoLabel(frame) {
  const el = document.getElementById('loco-label');
  if (!el) return;
  const text = `${frame.locomotive_id || ''}  ·  ${frame.locomotive_type || ''}`;
  if (el.textContent !== text) el.textContent = text;
}

// ---- Health index with smooth animated counter ----
function applyHealthIndex(index, category) {
  if (index == null) return;
  const cat    = HEALTH_CATS[category] || HEALTH_CATS.A;
  const scoreEl  = document.getElementById('health-score');
  const statusEl = document.getElementById('health-status');
  if (!scoreEl) return;

  if (_healthRafId) cancelAnimationFrame(_healthRafId);
  const start  = _healthDisplayed ?? index;
  const target = Math.round(index);
  const delta  = target - start;
  const steps  = 20;
  let step = 0;

  function tick() {
    step++;
    const eased = start + delta * (1 - Math.pow(1 - step / steps, 3));
    _healthDisplayed = eased;
    scoreEl.textContent = Math.round(eased);
    if (step < steps) _healthRafId = requestAnimationFrame(tick);
    else _healthDisplayed = target;
  }
  _healthRafId = requestAnimationFrame(tick);

  scoreEl.style.color      = cat.color;
  scoreEl.style.textShadow = `0 0 20px ${cat.color}40`;

  if (statusEl) {
    statusEl.innerHTML = `Состояние: ${cat.label} <span style="color:var(--text-muted);font-weight:normal;">(Риск: ${cat.risk})</span>`;
    statusEl.style.color = cat.color;
  }

  document.body.classList.toggle('critical-mode', category === 'E' || category === 'D');
}

// ---- Factors panel ----
function renderLiveFactors(factors) {
  const container = document.getElementById('factors-container');
  if (!container) return;

  let html = '';
  if (activeCategory) {
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;border-bottom:1px solid rgba(150,150,150,0.2);padding-bottom:10px;">
      <span style="color:var(--ktz-blue);font-size:0.85rem;font-weight:bold;text-transform:uppercase;">Фокус: ${activeCategory}</span>
      <button id="reset-filter-btn" class="action-btn" style="background:rgba(0,163,224,0.15);color:var(--ktz-blue);border:1px solid var(--ktz-blue);">🔄 Все узлы</button>
    </div>`;
  }

  factors.forEach(f => {
    const label = PARAM_LABELS[f.param] || f.param;
    const pct   = Math.round(f.penalty * 100);
    const color = pct > 70 ? 'var(--status-crit)' : pct > 30 ? 'var(--status-warn)' : 'var(--status-norm)';
    html += `
      <div class="factor-item">
        <div class="factor-header">
          <span style="color:${color}">${label}</span>
          <span style="color:${color}">−${pct} балл.</span>
        </div>
        <div class="factor-bar"><div class="factor-fill" style="width:${pct}%;background:${color};"></div></div>
      </div>`;
  });

  if (!factors.length) {
    html += `<div style="text-align:center;color:var(--status-norm);font-size:0.9rem;padding:10px;">✅ Все параметры в норме</div>`;
  }

  container.innerHTML = html;
}

// ---- Schema nodes ----
function applySchemaNodes(alerts, data) {
  const nodes = {
    power:  document.getElementById('node-power'),
    engine: document.getElementById('node-engine'),
    brakes: document.getElementById('node-brakes'),
  };
  if (!nodes.power) return;

  nodes.power.className  = 'schema-node status-norm';
  nodes.engine.className = 'schema-node status-norm';
  nodes.brakes.className = 'schema-node status-norm';
  nodes.power.textContent  = currentLocoType === 'KZ8A' ? '🔋 Питание' : '⛽ Дизель';
  nodes.engine.textContent = '⚙️ Двигатель';
  nodes.brakes.textContent = '🛑 Тормоза';

  const nodeMap = {
    E001:'engine', E003:'power', E004:'power', E006:'engine',
    E007:'engine', E008:'power', E010:'power', E011:'power',
    E012:'engine', E002:'brakes', E005:'brakes',
  };

  alerts.forEach(a => {
    const key = nodeMap[a.code];
    if (!key) return;
    const cls = a.severity === 'critical' ? 'status-crit' : 'status-warn';
    if (nodes[key].className.includes('status-norm')) nodes[key].className = `schema-node ${cls}`;
  });
}

// ---- Alerts panel ----
function applyAlerts(alerts) {
  const alertBox = document.getElementById('dynamic-alert');
  if (!alertBox) return;

  if (!alerts.length) {
    alertBox.className = 'alert-card norm-state';
    alertBox.style.borderLeft = '';
    alertBox.innerHTML = `
      <span class="alert-icon">✅</span>
      <div class="alert-content">
        <strong style="font-size:1.05rem;color:var(--text-main);">ОТКЛОНЕНИЙ НЕ ВЫЯВЛЕНО</strong>
        <p style="color:var(--text-muted);margin-top:4px;">Все системы работают в штатном режиме.</p>
      </div>`;
    return;
  }

  const critical = alerts.filter(a => a.severity === 'critical');
  const top = critical[0] || alerts[0];
  const severityColor = top.severity === 'critical' ? 'var(--status-crit)' : 'var(--status-warn)';
  const icon = top.severity === 'critical' ? '🚨' : '⚠️';
  const others = alerts.length > 1
    ? `<p style="color:var(--text-muted);font-size:0.8rem;margin-top:6px;">+${alerts.length - 1} других алертов</p>`
    : '';

  alertBox.className = top.severity === 'critical' ? 'alert-card critical' : 'alert-card warn-state';
  alertBox.style.borderLeft = `4px solid ${severityColor}`;
  alertBox.innerHTML = `
    <span class="alert-icon">${icon}</span>
    <div class="alert-content" style="flex-grow:1;">
      <strong style="color:${severityColor};font-size:1.05rem;">[${top.code}] ${top.message}</strong>
      <p style="color:var(--text-main);margin:4px 0 0;font-size:0.9rem;">Значение: <strong>${top.value}</strong></p>
      ${others}
    </div>`;
}

// ---- Stat cards (build DOM once, update textContent only) ----
function applyStatCards(data, locoType) {
  // Pressure
  const bpp = data.brake_pipe_pressure;
  if (bpp != null) {
    const kgf   = (bpp / 98.0665).toFixed(1);
    const color = bpp < 310 ? 'var(--status-crit)' : bpp < 450 ? 'var(--status-warn)' : 'var(--text-main)';
    const el = document.getElementById('pressure-val');
    if (el) {
      if (!el.dataset.init) {
        el.innerHTML = `<span id="pressure-num" style="min-width:3ch;display:inline-block;font-variant-numeric:tabular-nums;"></span> <small style="color:var(--text-muted);font-size:1rem;">кгс/см²</small>`;
        el.dataset.init = '1';
      }
      const n = document.getElementById('pressure-num');
      if (n) { n.textContent = kgf; n.style.color = color; }
    }
  }

  const voltageEl = document.getElementById('voltage-val');
  const fuelEl    = document.getElementById('fuel-val');

  if (locoType === 'KZ8A') {
    const cv = data.catenary_voltage;
    if (cv != null && voltageEl) {
      if (!voltageEl.dataset.init) {
        voltageEl.innerHTML = `<span id="voltage-num" style="min-width:3ch;display:inline-block;font-variant-numeric:tabular-nums;"></span> <small style="color:var(--text-muted);font-size:1rem;">кВ</small>`;
        voltageEl.dataset.init = '1';
        const lbl = voltageEl.closest('.stat-card')?.querySelector('.stat-label');
        if (lbl) lbl.textContent = 'Напряжение КС';
      }
      const color = cv < 17 || cv > 29 ? 'var(--status-crit)' : cv < 19 || cv > 28 ? 'var(--status-warn)' : 'var(--text-main)';
      const n = document.getElementById('voltage-num');
      if (n) { n.textContent = cv.toFixed(1); n.style.color = color; }
    }
    const pwr = data.total_power_consumption;
    if (pwr != null && fuelEl) {
      if (!fuelEl.dataset.init) {
        fuelEl.innerHTML = `<span id="fuel-num" style="min-width:4ch;display:inline-block;font-variant-numeric:tabular-nums;"></span> <small style="color:var(--text-muted);font-size:1rem;">кВт</small>`;
        fuelEl.dataset.init = '1';
        const lbl = fuelEl.closest('.stat-card')?.querySelector('.stat-label');
        if (lbl) lbl.textContent = 'Потребл. мощность';
      }
      const n = document.getElementById('fuel-num');
      if (n) n.textContent = Math.round(pwr);
    }
  } else {
    const rpm = data.engine_rpm;
    if (rpm != null && voltageEl) {
      if (!voltageEl.dataset.init) {
        voltageEl.innerHTML = `<span id="voltage-num" style="min-width:4ch;display:inline-block;font-variant-numeric:tabular-nums;"></span> <small style="color:var(--text-muted);font-size:1rem;">об/мин</small>`;
        voltageEl.dataset.init = '1';
        const lbl = voltageEl.closest('.stat-card')?.querySelector('.stat-label');
        if (lbl) lbl.textContent = 'Обороты двигателя';
      }
      const n = document.getElementById('voltage-num');
      if (n) n.textContent = Math.round(rpm);
    }
    const fl = data.fuel_level;
    const fr = data.fuel_consumption_rate;
    if (fl != null && fuelEl) {
      if (!fuelEl.dataset.init) {
        fuelEl.innerHTML = `<span id="fuel-num" style="min-width:3ch;display:inline-block;font-variant-numeric:tabular-nums;"></span> <small style="color:var(--text-muted);font-size:1rem;">%</small>`;
        fuelEl.dataset.init = '1';
        const lbl = fuelEl.closest('.stat-card')?.querySelector('.stat-label');
        if (lbl) lbl.textContent = 'Уровень топлива';
      }
      const color = fl < 5 ? 'var(--status-crit)' : fl < 15 ? 'var(--status-warn)' : 'var(--text-main)';
      const n = document.getElementById('fuel-num');
      if (n) { n.textContent = Math.round(fl); n.style.color = color; }
      const ctx = fuelEl.closest('.stat-card')?.querySelector('.stat-context');
      if (ctx && fr != null) {
        const h = fr > 0 ? (fl / fr * 100).toFixed(0) : '—';
        ctx.innerHTML = `↓ Расход: <strong style="color:var(--text-main);">${Math.round(fr)} л/ч</strong><br>⏱ Остаток: <strong style="color:var(--ktz-blue);">~${h} ч.</strong>`;
      }
    }
  }
}

// ============================================================
// CHART VIEW RENDERER
// ============================================================

function updateChartView(myChart) {
  if (!myChart) return;
  const n     = fullTime.length;
  const end   = Math.min(viewEnd, n);
  const start = Math.max(0, end - WINDOW_SIZE);
  const isLive = (end === n && !isPaused);

  // History banner
  const banner = document.getElementById('history-banner');
  if (banner) banner.style.display = isLive ? 'none' : 'flex';

  const liveBadge      = document.getElementById('chart-live-badge');
  const timelineStatus = document.getElementById('timeline-status');

  if (liveBadge) {
    liveBadge.textContent = isLive ? 'LIVE' : isPaused ? 'PAUSED' : 'REPLAY';
    liveBadge.style.color = isLive ? 'var(--status-crit)' : 'var(--status-warn)';
  }
  if (timelineStatus) {
    timelineStatus.textContent = isLive ? 'LIVE' : `−${n - end}s`;
    timelineStatus.style.color = isLive ? 'var(--status-norm)' : 'var(--status-warn)';
  }

  myChart.setOption({
    xAxis: { data: fullTime.slice(start, end) },
    series: [
      { data: fullSpeed.slice(start, end),   itemStyle: { color: isLive ? '#00A3E0' : '#8e8e93' } },
      { data: fullTemp.slice(start, end) },
      { data: fullPredict.slice(start, end), lineStyle: { opacity: fullPredict.slice(start, end).some(v => v !== null) ? 1 : 0 } },
    ],
  });

  if (lastFrame?.data && window._updateMapMarker) {
    window._updateMapMarker(lastFrame.data.latitude, lastFrame.data.longitude);
  }
}

// Jump back to live stream from history mode
function jumpToLive() {
  isPaused = false;
  viewEnd  = fullTime.length;
  const pb = document.getElementById('play-pause');
  if (pb) pb.textContent = '⏸ Pause';
  const slider = document.querySelector('.timeline-slider');
  if (slider) slider.value = viewEnd;
  if (window._myChart) updateChartView(window._myChart);
}

// ============================================================
// MAIN
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  const chartDom = document.getElementById('main-chart');
  const myChart  = echarts.init(chartDom);
  window._myChart = myChart;

  myChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(10,11,14,0.9)', borderColor: '#444', textStyle: { color: '#fff' } },
    legend: { data: ['Скорость', 'Темп. ТЭД', 'Прогноз (AI)'], textStyle: { color: '#a1a1aa' } },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: [], axisLabel: { color: '#a1a1aa' } },
    yAxis: [
      { type: 'value', name: 'км/ч',  position: 'left',  splitLine: { lineStyle: { color: '#222' } }, axisLabel: { color: '#a1a1aa' } },
      { type: 'value', name: '°C',    position: 'right', max: 200, splitLine: { show: false },         axisLabel: { color: '#a1a1aa' } },
    ],
    visualMap: {
      show: false, seriesIndex: 1,
      pieces: [{ gt: 0, lte: 140, color: '#00e676' }, { gt: 140, lte: 155, color: '#eab308' }, { gt: 155, color: '#ef4444' }],
    },
    series: [
      { name: 'Скорость',    type: 'line', smooth: true, itemStyle: { color: '#00A3E0' }, data: [] },
      { name: 'Темп. ТЭД',  type: 'line', smooth: true, yAxisIndex: 1, data: [],
        markLine: { silent: true, data: [
          { yAxis: 155, lineStyle: { color: '#eab308', type: 'dashed' } },
          { yAxis: 180, lineStyle: { color: '#ef4444', type: 'solid'  } },
        ]},
      },
      { name: 'Прогноз (AI)', type: 'line', smooth: true, yAxisIndex: 1,
        itemStyle: { color: '#f97316' }, lineStyle: { type: 'dashed', width: 2 }, data: [] },
    ],
  });

  function pushChartData(frame) {
    const data = frame.data || {};
    const d = new Date(frame.timestamp || Date.now());
    const ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;

    const speed = data.speed ?? 0;
    const temp  = data.traction_motor_temperature ?? 0;
    const prevT = fullTemp[fullTemp.length - 1];
    const predict = (prevT != null && temp > prevT && temp > 130)
      ? parseFloat((temp + (temp - prevT) * 3).toFixed(1)) : null;

    fullTime.push(ts);
    fullSpeed.push(parseFloat(speed.toFixed(1)));
    fullTemp.push(parseFloat(temp.toFixed(1)));
    fullPredict.push(predict);

    if (fullTime.length > MAX_BUF) {
      fullTime.shift(); fullSpeed.shift(); fullTemp.shift(); fullPredict.shift();
      if (viewEnd > 0) viewEnd--;
    }

    const slider = document.querySelector('.timeline-slider');
    if (slider) slider.max = fullTime.length;

    if (!isPaused) {
      viewEnd = fullTime.length;
      if (slider) slider.value = viewEnd;
    }

    updateChartView(myChart);
  }

  window._pushChartData   = pushChartData;
  window._updateChartView = () => updateChartView(myChart);

  // ---- Schema node click filter ----
  const nodes = {
    power:  document.getElementById('node-power'),
    engine: document.getElementById('node-engine'),
    brakes: document.getElementById('node-brakes'),
  };
  const CATEGORY_PARAMS = {
    engine: ['traction_motor_temperature','traction_motor_current','engine_coolant_temperature','exhaust_temperature'],
    power:  ['catenary_voltage','dc_bus_voltage','transformer_oil_temperature','traction_converter_temperature','fuel_level'],
    brakes: ['brake_pipe_pressure','main_reservoir_pressure'],
  };

  Object.keys(nodes).forEach(cat => {
    if (!nodes[cat]) return;
    nodes[cat].addEventListener('click', () => {
      activeCategory = cat;
      Object.entries(nodes).forEach(([k, n]) => {
        if (!n) return;
        n.style.opacity   = k === cat ? '1' : '0.3';
        n.style.boxShadow = k === cat ? '0 0 15px rgba(255,255,255,0.3)' : 'none';
      });
      if (lastFrame) {
        const rel = (lastFrame.health_factors || []).filter(f => (CATEGORY_PARAMS[cat] || []).includes(f.param));
        renderLiveFactors(rel.length ? rel : lastFrame.health_factors || []);
      }
    });
  });

  document.getElementById('factors-container').addEventListener('click', (e) => {
    if (e.target.id === 'reset-filter-btn') {
      activeCategory = null;
      Object.values(nodes).forEach(n => { if (n) { n.style.opacity = '1'; n.style.boxShadow = 'none'; } });
      if (lastFrame) renderLiveFactors(lastFrame.health_factors || []);
    }
  });

  // ---- Play / Pause ----
  const playPauseBtn = document.getElementById('play-pause');
  playPauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    playPauseBtn.textContent = isPaused ? '▶ Play' : '⏸ Pause';
    if (!isPaused && lastFrame) applyFrame(lastFrame);
    updateChartView(myChart);
  });

  // ---- Timeline slider ----
  const slider = document.querySelector('.timeline-slider');
  slider.min   = WINDOW_SIZE;
  slider.max   = fullTime.length;
  slider.value = viewEnd;
  slider.addEventListener('input', (e) => {
    isPaused = true;
    playPauseBtn.textContent = '▶ Play';
    viewEnd = parseInt(e.target.value);
    updateChartView(myChart);
    // Show the live data for the frame at this point in time
    if (lastFrame) applyFrame(lastFrame);
  });

  // ---- Replay -5min from backend SSE ----
  const replayBtn = document.querySelector('.replay-controls .action-btn');
  replayBtn.addEventListener('click', async () => {
    const now  = new Date();
    const from = new Date(now - 5 * 60 * 1000);
    const url  = `${BACKEND_HTTP}/api/history/replay?from=${from.toISOString()}&to=${now.toISOString()}&speed=4`;

    isPaused = true;
    playPauseBtn.textContent = '▶ Play';
    replayBtn.textContent = '⏳ Загрузка...';

    fullTime.length = 0; fullSpeed.length = 0; fullTemp.length = 0; fullPredict.length = 0;
    viewEnd = 0;

    try {
      const evtSrc = new EventSource(url);
      evtSrc.onmessage = (e) => {
        const frame = JSON.parse(e.data);
        pushChartData(frame);
        applyFrame(frame);
        viewEnd = fullTime.length;
        updateChartView(myChart);
      };
      evtSrc.onerror = () => { evtSrc.close(); replayBtn.textContent = '⏪ -5m'; };
      setTimeout(() => { evtSrc.close(); replayBtn.textContent = '⏪ -5m'; }, 70000);
    } catch { replayBtn.textContent = '⏪ -5m'; }
  });

  // ---- Highload ----
  let highloadActive = false;
  const highloadBtn = document.getElementById('highload-btn');
  highloadBtn.addEventListener('click', () => {
    highloadActive = !highloadActive;
    if (highloadActive) {
      highloadBtn.textContent = '🛑 Stop Highload';
      highloadBtn.style.background = 'rgba(0,163,224,0.2)';
      window._highloadInterval = setInterval(() => {
        if (!lastFrame) return;
        const jf = JSON.parse(JSON.stringify(lastFrame));
        Object.keys(jf.data).forEach(k => { if (typeof jf.data[k] === 'number') jf.data[k] += (Math.random()-0.5)*2; });
        pushChartData(jf);
      }, 100);
    } else {
      highloadBtn.textContent = '🚀 x10 Load';
      highloadBtn.style.background = 'transparent';
      clearInterval(window._highloadInterval);
    }
  });

  // ---- Simulate failure ----
  const failureBtn = document.getElementById('simulate-failure-btn');
  failureBtn.addEventListener('click', () => {
    isFailureMode = !isFailureMode;
    if (isFailureMode) {
      document.body.classList.add('critical-mode');
      applyHealthIndex(47, 'D');
      applyAlerts([
        { code:'E001', severity:'critical', message:'Перегрев ТЭД',       value: 178 },
        { code:'E002', severity:'warning',  message:'Падение давления ТМ', value: 320 },
      ]);
      const eng = document.getElementById('node-engine');
      if (eng) { eng.className = 'schema-node status-crit'; eng.textContent = '🔥 Двигатель (Отказ)'; }
      failureBtn.innerHTML = '✅ Restore System';
      failureBtn.style.borderColor = 'var(--status-norm)';
      failureBtn.style.color       = 'var(--status-norm)';
    } else {
      isFailureMode = false;
      document.body.classList.remove('critical-mode');
      if (lastFrame) applyFrame(lastFrame);
      failureBtn.innerHTML = '🔥 Simulate Failure';
      failureBtn.style.borderColor = 'var(--status-crit)';
      failureBtn.style.color       = 'var(--status-crit)';
    }
  });

  // ---- Export ----
  const exportDropdownBtn = document.getElementById('export-dropdown-btn');
  exportDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdownBtn.parentElement.classList.toggle('show');
  });
  window.addEventListener('click', () => exportDropdownBtn.parentElement.classList.remove('show'));

  function showExportSuccess() {
    const orig = exportDropdownBtn.innerHTML;
    exportDropdownBtn.innerHTML = '✅ Сохранено';
    exportDropdownBtn.style.background = '#00e676';
    exportDropdownBtn.style.color = '#000';
    setTimeout(() => { exportDropdownBtn.innerHTML = orig; exportDropdownBtn.style.background = 'var(--ktz-blue)'; exportDropdownBtn.style.color = '#fff'; }, 2000);
  }

  document.getElementById('export-csv').addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const now  = new Date();
      const from = new Date(now - 3600000);
      const res  = await fetch(`${BACKEND_HTTP}/api/export?from=${from.toISOString()}&to=${now.toISOString()}&format=csv`);
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href  = URL.createObjectURL(blob);
      link.download = `KTZ_Telemetry_${Date.now()}.csv`;
      link.click();
    } catch {
      let csv = 'Время,Скорость (км/ч),Температура ТЭД (°C)\n';
      for (let i = 0; i < fullTime.length; i++) csv += `${fullTime[i]},${fullSpeed[i]},${fullTemp[i]}\n`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
      link.download = `KTZ_Telemetry_local_${Date.now()}.csv`;
      link.click();
    }
    showExportSuccess();
  });

  document.getElementById('export-pdf').addEventListener('click', (e) => {
    e.preventDefault();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(0, 163, 224);
    doc.text('KTZ Loco-Twin Telemetry Report', 14, 22);
    doc.setFontSize(10); doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
    if (lastFrame) {
      doc.text(`Locomotive: ${lastFrame.locomotive_id} (${lastFrame.locomotive_type})`, 14, 36);
      doc.text(`Health Index: ${lastFrame.health_index} (${lastFrame.health_category})`, 14, 42);
    }
    const body = fullTime.map((t, i) => {
      const tmp = fullTemp[i];
      const s   = tmp >= 180 ? 'CRITICAL' : tmp >= 155 ? 'WARNING' : 'NORMAL';
      return [t, fullSpeed[i], tmp, s];
    });
    doc.autoTable({
      startY: 50,
      head: [['Время', 'Скорость (км/ч)', 'Темп. ТЭД (°C)', 'Статус']],
      body, theme: 'grid', headStyles: { fillColor: [0, 163, 224] },
      didParseCell(data) {
        if (data.section === 'body' && data.column.index === 3) {
          if (data.cell.raw === 'CRITICAL') { data.cell.styles.textColor = [239,68,68]; data.cell.styles.fontStyle = 'bold'; }
          else if (data.cell.raw === 'WARNING') data.cell.styles.textColor = [234,179,8];
        }
      },
    });
    doc.save(`KTZ_Report_${Date.now()}.pdf`);
    showExportSuccess();
  });

  // ---- Theme ----
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  function applyChartTheme() {
    const isLight = document.body.classList.contains('light-mode');
    const tc = isLight ? '#4b5563' : '#a1a1aa';
    const gc = isLight ? '#e5e7eb' : '#222';
    myChart.setOption({
      tooltip: { backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(10,11,14,0.9)', borderColor: gc, textStyle: { color: isLight ? '#111827' : '#fff' } },
      legend:  { textStyle: { color: tc } },
      xAxis:   { axisLabel: { color: tc } },
      yAxis:   [{ splitLine: { lineStyle: { color: gc } }, axisLabel: { color: tc } }, { axisLabel: { color: tc } }],
    });
  }

  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-mode');
    themeToggleBtn.innerHTML = '🌙 Dark';
  }
  applyChartTheme();

  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    themeToggleBtn.innerHTML = isLight ? '🌙 Dark' : '☀️ Light';
    applyChartTheme();
  });

  // ---- Tabs ----
  const tabTrends      = document.getElementById('tab-trends');
  const tabMap         = document.getElementById('tab-map');
  const chartContainer = document.getElementById('main-chart');
  const mapContainer   = document.getElementById('map-container');
  const mapControls    = document.getElementById('map-controls');
  const replayPanel    = document.getElementById('replay-panel');

  let map, trainMarker, routeLine;

  const stationsData = {
    astana:    [51.1282, 71.4304],
    almaty:    [43.2389, 76.8897],
    karaganda: [49.8019, 73.0858],
    pavlodar:  [52.2833, 76.9667],
  };
  const railwayRoutes = {
    'astana-karaganda': [[51.1282,71.4304],[50.846,72.046],[50.568,72.567],[50.06,72.96],[49.8019,73.0858]],
    'astana-pavlodar':  [[51.1282,71.4304],[51.62,73.1],[51.72,75.32],[52.2833,76.9667]],
    'karaganda-almaty': [[49.8019,73.0858],[48.8115,73.5303],[46.8456,74.9814],[43.6028,73.7606],[43.2389,76.8897]],
  };

  function initMap() {
    if (map) return;
    map = L.map('map-container').setView(stationsData.astana, 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(map);
    const icon = L.divIcon({ html: '🚂', className: 'train-icon', iconSize: [30,30], iconAnchor: [15,15] });
    trainMarker = L.marker(stationsData.astana, { icon }).addTo(map);
    drawRoute();
  }

  function drawRoute() {
    if (!map) return;
    const a = document.getElementById('station-a').value;
    const b = document.getElementById('station-b').value;
    const r = railwayRoutes[`${a}-${b}`] || (railwayRoutes[`${b}-${a}`] ? [...railwayRoutes[`${b}-${a}`]].reverse() : [stationsData[a], stationsData[b]]);
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(r, { color:'#00A3E0', weight:4, dashArray:'10,10' }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding:[50,50] });
    trainMarker.setLatLng(stationsData[a]);
  }

  window._updateMapMarker = (lat, lon) => {
    if (trainMarker && lat != null && lon != null) trainMarker.setLatLng([lat, lon]);
  };

  document.getElementById('station-a').addEventListener('change', drawRoute);
  document.getElementById('station-b').addEventListener('change', drawRoute);

  tabTrends.addEventListener('click', () => {
    tabTrends.className = 'btn primary-btn'; tabMap.className = 'btn outline-btn';
    mapContainer.style.display = 'none'; mapControls.style.display = 'none';
    chartContainer.style.display = 'block'; replayPanel.style.display = 'flex';
    myChart.resize();
  });
  tabMap.addEventListener('click', () => {
    tabMap.className = 'btn primary-btn'; tabTrends.className = 'btn outline-btn';
    chartContainer.style.display = 'none'; replayPanel.style.display = 'none';
    mapControls.style.display = 'flex'; mapContainer.style.display = 'block';
    initMap(); setTimeout(() => map.invalidateSize(), 100);
  });

  window.addEventListener('resize', () => {
    if (chartContainer.style.display !== 'none') myChart.resize();
  });

  // ---- Boot ----
  setConnectionStatus(false);
  startSyncTicker();
  connectWS();
});
