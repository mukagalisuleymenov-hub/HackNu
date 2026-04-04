const HOST = location.hostname || "localhost";
const BACKEND_WS = `ws://${HOST}:8000/ws/live`;
const BACKEND_HTTP = `http://${HOST}:8000`;

const HEALTH_CATS = {
  A: {
    label: "СТАБИЛЬНО",
    risk: "Минимальный",
    color: "#22c55e",
    cssVar: "var(--status-norm)",
  },
  B: { label: "Хорошо", risk: "Низкий", color: "#84cc16", cssVar: "#84cc16" },
  C: {
    label: "ВНИМАНИЕ",
    risk: "Умеренный",
    color: "#eab308",
    cssVar: "var(--status-warn)",
  },
  D: {
    label: "ПРЕДУПРЕЖДЕНИЕ",
    risk: "Высокий",
    color: "#f97316",
    cssVar: "#f97316",
  },
  E: {
    label: "КРИТИЧНО",
    risk: "ВЫСОКИЙ",
    color: "#ef4444",
    cssVar: "var(--status-crit)",
  },
};

const PARAM_LABELS = {
  traction_motor_temperature: "Температура ТЭД",
  brake_pipe_pressure: "Давление ТМ",
  main_reservoir_pressure: "Давление ГР",
  catenary_voltage: "Напряжение КС",
  transformer_oil_temperature: "Темп. трансформатора",
  traction_converter_temperature: "Темп. IGBT-преобр.",
  engine_coolant_temperature: "Темп. охлаждения",
  engine_oil_pressure: "Давление масла",
  fuel_level: "Уровень топлива",
  exhaust_temperature: "Темп. выхлопа",
  speed: "Скорость",
  traction_motor_current: "Ток ТЭД",
};

// ============================================================
// STATE
// ============================================================

let isPaused = false;
let isFailureMode = false; // manual demo override
let activeCategory = null;
let lastFrame = null;
let currentLocoType = "KZ8A";

// Chart data buffers
const WINDOW_SIZE = 60;
const MAX_BUF = 1200;
let fullTime = [],
  fullSpeed = [],
  fullTemp = [],
  fullPredict = [];
let viewEnd = 0;

// WebSocket reconnect
let wsReconnectDelay = 1000;
let ws = null;
let lastMessageTime = null;

// Sync ticker
let syncTimerId = null;

// ============================================================
// WEBSOCKET
// ============================================================

function connectWS() {
  ws = new WebSocket(BACKEND_WS);

  ws.onopen = () => {
    wsReconnectDelay = 1000;
    setConnectionStatus(true);
    console.log("[WS] Connected to", BACKEND_WS);
  };

  ws.onmessage = (e) => {
    lastMessageTime = Date.now();
    try {
      const frame = JSON.parse(e.data);
      lastFrame = frame;
      pushChartData(frame);
      if (!isFailureMode) applyFrame(frame);
    } catch (err) {
      console.warn("[WS] Parse error:", err);
    }
  };

  ws.onclose = () => {
    setConnectionStatus(false);
    console.warn(`[WS] Disconnected. Retry in ${wsReconnectDelay}ms`);
    setTimeout(connectWS, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
  };

  ws.onerror = () => ws.close();
}

function setConnectionStatus(online) {
  const ping = document.getElementById("ping-indicator");
  const sync = document.getElementById("sync-indicator");
  if (online) {
    ping.textContent = "🟢 Connected";
    ping.style.color = "var(--status-norm)";
  } else {
    ping.textContent = "🔴 Offline";
    ping.style.color = "var(--status-crit)";
    sync.textContent = "Reconnecting...";
  }
}

// Update "X.Xs ago" ticker every second
function startSyncTicker() {
  clearInterval(syncTimerId);
  syncTimerId = setInterval(() => {
    const sync = document.getElementById("sync-indicator");
    if (!lastMessageTime) {
      sync.textContent = "No data yet";
      return;
    }
    const ago = ((Date.now() - lastMessageTime) / 1000).toFixed(1);
    sync.textContent = `Sync: ${ago}s ago`;
    sync.style.color = ago > 3 ? "var(--status-warn)" : "var(--text-muted)";
  }, 500);
}

// ============================================================
// APPLY FRAME → UI
// ============================================================

function applyFrame(frame) {
  if (!frame) return;
  const data = frame.data || {};

  // Track loco type for conditional panels
  if (frame.locomotive_type) currentLocoType = frame.locomotive_type;

  // --- Locomotive label in header ---
  let locoLabel = document.getElementById("loco-label");
  if (!locoLabel) {
    locoLabel = document.createElement("span");
    locoLabel.id = "loco-label";
    locoLabel.style.cssText =
      "font-size:0.85rem; color:var(--ktz-blue); font-weight:700; letter-spacing:1px;";
    document.querySelector(".logo-area").appendChild(locoLabel);
  }
  locoLabel.textContent = `${frame.locomotive_id || ""} · ${frame.locomotive_type || ""} · ${frame.scenario || ""}`;

  // --- Health index ---
  applyHealthIndex(frame.health_index, frame.health_category);

  // --- Health factors breakdown ---
  if (!activeCategory) {
    renderLiveFactors(frame.health_factors || []);
  }

  // --- Schema nodes ---
  applySchemaNodes(frame.alerts || [], data);

  // --- Alerts panel ---
  applyAlerts(frame.alerts || []);

  // --- Stat cards ---
  applyStatCards(data, currentLocoType);
}

function applyHealthIndex(index, category) {
  if (index == null) return;
  const cat = HEALTH_CATS[category] || HEALTH_CATS.A;

  const scoreEl = document.getElementById("health-score");
  const statusEl = document.getElementById("health-status");

  scoreEl.textContent = Math.round(index);
  scoreEl.style.color = cat.color;

  statusEl.innerHTML = `Состояние: ${cat.label} <span style="color:var(--text-muted); font-weight:normal;">(Риск: ${cat.risk})</span>`;
  statusEl.style.color = cat.color;

  document.body.classList.toggle(
    "critical-mode",
    category === "E" || category === "D",
  );
}

function renderLiveFactors(factors) {
  const container = document.getElementById("factors-container");
  if (!container) return;

  let html = "";
  factors.forEach((f) => {
    const label = PARAM_LABELS[f.param] || f.param;
    const pct = Math.round(f.penalty * 100);
    const score = 100 - pct;
    const color =
      pct > 70
        ? "var(--status-crit)"
        : pct > 30
          ? "var(--status-warn)"
          : "var(--status-norm)";
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
    html = `<div style="text-align:center;color:var(--status-norm);font-size:0.9rem;padding:10px;">✅ Все параметры в норме</div>`;
  }

  // Only update if not in filter mode
  if (!activeCategory) container.innerHTML = html;
}

function applySchemaNodes(alerts, data) {
  const nodes = {
    power: document.getElementById("node-power"),
    engine: document.getElementById("node-engine"),
    brakes: document.getElementById("node-brakes"),
  };

  // Reset
  nodes.power.className = "schema-node status-norm";
  nodes.engine.className = "schema-node status-norm";
  nodes.brakes.className = "schema-node status-norm";
  nodes.power.textContent =
    currentLocoType === "KZ8A" ? "🔋 Питание" : "⛽ Дизель";
  nodes.engine.textContent = "⚙️ Двигатель";
  nodes.brakes.textContent = "🛑 Тормоза";

  // Map alert codes to nodes
  const nodeMap = {
    E001: "engine",
    E003: "power",
    E004: "power",
    E006: "engine",
    E007: "engine",
    E008: "power",
    E010: "power",
    E011: "power",
    E012: "engine",
    E002: "brakes",
    E005: "brakes",
  };

  alerts.forEach((a) => {
    const nodeKey = nodeMap[a.code];
    if (!nodeKey) return;
    const cls = a.severity === "critical" ? "status-crit" : "status-warn";
    if (nodes[nodeKey].className.includes("status-norm")) {
      nodes[nodeKey].className = `schema-node ${cls}`;
    }
  });
}

function applyAlerts(alerts) {
  const alertBox = document.getElementById("dynamic-alert");
  if (!alertBox) return;

  const critical = alerts.filter((a) => a.severity === "critical");
  const warnings = alerts.filter((a) => a.severity === "warning");

  if (!alerts.length) {
    alertBox.className = "alert-card norm-state";
    alertBox.innerHTML = `
      <span class="alert-icon">✅</span>
      <div class="alert-content">
        <strong style="font-size:1.05rem;color:var(--text-main);">ОТКЛОНЕНИЙ НЕ ВЫЯВЛЕНО</strong>
        <p style="color:var(--text-muted);margin-top:4px;">Все системы работают в штатном режиме.</p>
      </div>`;
    return;
  }

  const top = critical[0] || warnings[0];
  const severityColor =
    top.severity === "critical" ? "var(--status-crit)" : "var(--status-warn)";
  const icon = top.severity === "critical" ? "🚨" : "⚠️";
  const others =
    alerts.length > 1
      ? `<p style="color:var(--text-muted);font-size:0.8rem;margin-top:6px;">+${alerts.length - 1} других алертов</p>`
      : "";

  alertBox.className =
    top.severity === "critical"
      ? "alert-card critical"
      : "alert-card warn-state";
  alertBox.style.borderLeft = `4px solid ${severityColor}`;
  alertBox.innerHTML = `
    <span class="alert-icon">${icon}</span>
    <div class="alert-content" style="flex-grow:1;">
      <strong style="color:${severityColor};font-size:1.05rem;">[${top.code}] ${top.message}</strong>
      <p style="color:var(--text-main);margin:4px 0 0;font-size:0.9rem;">Значение: <strong>${top.value}</strong></p>
      ${others}
    </div>`;
}

function applyStatCards(data, locoType) {
  // Pressure: kPa → kgf/cm² (÷ 98.0665)
  const pressureEl = document.getElementById("pressure-val");
  const bpp = data.brake_pipe_pressure;
  if (bpp != null && pressureEl) {
    const kgf = (bpp / 98.0665).toFixed(1);
    const color =
      bpp < 310
        ? "var(--status-crit)"
        : bpp < 450
          ? "var(--status-warn)"
          : "var(--text-main)";
    pressureEl.innerHTML = `<span style="color:${color}">${kgf}</span> <small style="color:var(--text-muted);font-size:1rem;">кгс/см²</small>`;
  }

  const voltageEl = document.getElementById("voltage-val");
  const fuelEl = document.getElementById("fuel-val");

  if (locoType === "KZ8A") {
    const cv = data.catenary_voltage;
    if (cv != null && voltageEl) {
      const color =
        cv < 17 || cv > 29
          ? "var(--status-crit)"
          : cv < 19 || cv > 28
            ? "var(--status-warn)"
            : "var(--text-main)";
      voltageEl.innerHTML = `<span style="color:${color}">${cv.toFixed(1)}</span> <small style="color:var(--text-muted);font-size:1rem;">кВ</small>`;
    }
    const pwr = data.total_power_consumption;
    if (pwr != null && fuelEl) {
      fuelEl.innerHTML = `${Math.round(pwr)} <small style="color:var(--text-muted);font-size:1rem;">кВт</small>`;
      // Update label
      const fuelLabel = fuelEl
        .closest(".stat-card")
        ?.querySelector(".stat-label");
      if (fuelLabel) fuelLabel.textContent = "Потребл. мощность";
    }
  } else {
    // TE33A
    const rpm = data.engine_rpm;
    if (rpm != null && voltageEl) {
      voltageEl.innerHTML = `${Math.round(rpm)} <small style="color:var(--text-muted);font-size:1rem;">об/мин</small>`;
      const vLabel = voltageEl
        .closest(".stat-card")
        ?.querySelector(".stat-label");
      if (vLabel) vLabel.textContent = "Обороты двигателя";
    }
    const fl = data.fuel_level;
    const fr = data.fuel_consumption_rate;
    if (fl != null && fuelEl) {
      const hoursLeft = fr > 0 ? ((fl / fr) * 100).toFixed(0) : "—";
      const color =
        fl < 5
          ? "var(--status-crit)"
          : fl < 15
            ? "var(--status-warn)"
            : "var(--text-main)";
      fuelEl.innerHTML = `<span style="color:${color}">${Math.round(fl)}</span> <small style="color:var(--text-muted);font-size:1rem;">%</small>`;
      const fuelLabel = fuelEl
        .closest(".stat-card")
        ?.querySelector(".stat-label");
      if (fuelLabel) fuelLabel.textContent = "Уровень топлива";
      const ctx = fuelEl.closest(".stat-card")?.querySelector(".stat-context");
      if (ctx && fr != null) {
        ctx.innerHTML = `↓ Расход: <strong style="color:var(--text-main);">${Math.round(fr)} л/ч</strong><br>⏱ Остаток: <strong style="color:var(--ktz-blue);">~${hoursLeft} ч.</strong>`;
      }
    }
  }
}

// ============================================================
// CHART
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const chartDom = document.getElementById("main-chart");
  const myChart = echarts.init(chartDom);

  const getOption = () => ({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(10,11,14,0.9)",
      borderColor: "#444",
      textStyle: { color: "#fff" },
    },
    legend: {
      data: ["Скорость", "Темп. ТЭД", "Прогноз (AI)"],
      textStyle: { color: "#a1a1aa" },
    },
    grid: { left: "3%", right: "4%", bottom: "3%", containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: [],
      axisLabel: { color: "#a1a1aa" },
    },
    yAxis: [
      {
        type: "value",
        name: "км/ч",
        position: "left",
        splitLine: { lineStyle: { color: "#222" } },
        axisLabel: { color: "#a1a1aa" },
      },
      {
        type: "value",
        name: "°C",
        position: "right",
        max: 200,
        splitLine: { show: false },
        axisLabel: { color: "#a1a1aa" },
      },
    ],
    visualMap: {
      show: false,
      seriesIndex: 1,
      pieces: [
        { gt: 0, lte: 140, color: "#00e676" },
        { gt: 140, lte: 155, color: "#eab308" },
        { gt: 155, color: "#ef4444" },
      ],
    },
    series: [
      {
        name: "Скорость",
        type: "line",
        smooth: true,
        itemStyle: { color: "#00A3E0" },
        data: [],
      },
      {
        name: "Темп. ТЭД",
        type: "line",
        smooth: true,
        yAxisIndex: 1,
        data: [],
        markLine: {
          silent: true,
          data: [
            { yAxis: 155, lineStyle: { color: "#eab308", type: "dashed" } },
            { yAxis: 180, lineStyle: { color: "#ef4444", type: "solid" } },
          ],
        },
      },
      {
        name: "Прогноз (AI)",
        type: "line",
        smooth: true,
        yAxisIndex: 1,
        itemStyle: { color: "#f97316" },
        lineStyle: { type: "dashed", width: 2 },
        data: [],
      },
    ],
  });
  myChart.setOption(getOption());

  function pushChartData(frame) {
    const data = frame.data || {};
    const d = new Date(frame.timestamp || Date.now());
    const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

    const speed = data.speed ?? 0;
    const temp = data.traction_motor_temperature ?? 0;
    // Simple linear extrapolation if temp is rising
    const prevTemp = fullTemp[fullTemp.length - 1];
    const predict =
      prevTemp != null && temp > prevTemp && temp > 130
        ? parseFloat((temp + (temp - prevTemp) * 3).toFixed(1))
        : null;

    fullTime.push(timeStr);
    fullSpeed.push(parseFloat(speed.toFixed(1)));
    fullTemp.push(parseFloat(temp.toFixed(1)));
    fullPredict.push(predict);

    if (fullTime.length > MAX_BUF) {
      fullTime.shift();
      fullSpeed.shift();
      fullTemp.shift();
      fullPredict.shift();
      if (viewEnd > 0) viewEnd--;
    }

    const slider = document.querySelector(".timeline-slider");
    if (slider) {
      slider.max = fullTime.length;
    }

    if (!isPaused) {
      viewEnd = fullTime.length;
      if (slider) slider.value = viewEnd;
    }

    updateChartView(myChart);
  }

  // Expose to outer scope
  window._pushChartData = pushChartData;
  window._updateChartView = () => updateChartView(myChart);
  window._myChart = myChart;

  // ---- Schema node click filter ----
  const nodes = {
    power: document.getElementById("node-power"),
    engine: document.getElementById("node-engine"),
    brakes: document.getElementById("node-brakes"),
  };

  const CATEGORY_TO_PARAMS = {
    engine: [
      "traction_motor_temperature",
      "traction_motor_current",
      "engine_coolant_temperature",
      "exhaust_temperature",
    ],
    power: [
      "catenary_voltage",
      "dc_bus_voltage",
      "transformer_oil_temperature",
      "traction_converter_temperature",
      "fuel_level",
    ],
    brakes: ["brake_pipe_pressure", "main_reservoir_pressure"],
  };

  Object.keys(nodes).forEach((category) => {
    nodes[category].addEventListener("click", () => {
      activeCategory = category;
      Object.entries(nodes).forEach(([k, n]) => {
        n.style.opacity = k === category ? "1" : "0.3";
        n.style.boxShadow =
          k === category ? "0 0 15px rgba(255,255,255,0.3)" : "none";
      });
      // Filter factors to this category's params
      if (lastFrame) {
        const relevant = (lastFrame.health_factors || []).filter((f) =>
          (CATEGORY_TO_PARAMS[category] || []).includes(f.param),
        );
        renderLiveFactors(
          relevant.length ? relevant : lastFrame.health_factors || [],
        );
      }
    });
  });

  // Reset filter
  document
    .getElementById("factors-container")
    .addEventListener("click", (e) => {
      if (e.target.id === "reset-filter-btn") {
        activeCategory = null;
        Object.values(nodes).forEach((n) => {
          n.style.opacity = "1";
          n.style.boxShadow = "none";
        });
        if (lastFrame) renderLiveFactors(lastFrame.health_factors || []);
      }
    });

  // ---- Play/Pause ----
  const playPauseBtn = document.getElementById("play-pause");
  playPauseBtn.addEventListener("click", () => {
    isPaused = !isPaused;
    playPauseBtn.textContent = isPaused ? "▶ Play" : "⏸ Pause";
    updateChartView(myChart);
  });

  // ---- Timeline slider ----
  const slider = document.querySelector(".timeline-slider");
  slider.min = WINDOW_SIZE;
  slider.max = fullTime.length;
  slider.value = viewEnd;
  slider.addEventListener("input", (e) => {
    isPaused = true;
    playPauseBtn.textContent = "▶ Play";
    viewEnd = parseInt(e.target.value);
    updateChartView(myChart);
  });

  // ---- Replay -5min from backend SSE ----
  const replayBtn = document.querySelector(".replay-controls .action-btn");
  replayBtn.addEventListener("click", async () => {
    const now = new Date();
    const from = new Date(now - 5 * 60 * 1000);
    const url = `${BACKEND_HTTP}/api/history/replay?from=${from.toISOString()}&to=${now.toISOString()}&speed=4`;

    isPaused = true;
    playPauseBtn.textContent = "▶ Play";
    replayBtn.textContent = "⏳ Загрузка...";

    // Clear chart
    fullTime.length = 0;
    fullSpeed.length = 0;
    fullTemp.length = 0;
    fullPredict.length = 0;
    viewEnd = 0;

    try {
      const evtSrc = new EventSource(url);
      evtSrc.onmessage = (e) => {
        const frame = JSON.parse(e.data);
        if (window._pushChartData) window._pushChartData(frame);
        applyFrame(frame);
        viewEnd = fullTime.length;
        updateChartView(myChart);
      };
      evtSrc.onerror = () => {
        evtSrc.close();
        replayBtn.textContent = "⏪ -5m";
      };
      setTimeout(() => {
        evtSrc.close();
        replayBtn.textContent = "⏪ -5m";
      }, 70000);
    } catch (err) {
      replayBtn.textContent = "⏪ -5m";
    }
  });

  // ---- Highload button ----
  // Real highload is driven from backend. Button shows a visual stress indicator.
  let highloadActive = false;
  const highloadBtn = document.getElementById("highload-btn");
  highloadBtn.addEventListener("click", async () => {
    highloadActive = !highloadActive;
    if (highloadActive) {
      highloadBtn.textContent = "🛑 Stop Highload";
      highloadBtn.style.background = "rgba(0,163,224,0.2)";
      // Kick backend simulator to x10 speed via a note (can't control it from here)
      // But we can stress the chart render by pushing ghost points rapidly
      window._highloadInterval = setInterval(() => {
        if (!lastFrame) return;
        // Duplicate last frame with jitter for visual stress test
        const jitterFrame = JSON.parse(JSON.stringify(lastFrame));
        const d = jitterFrame.data;
        Object.keys(d).forEach((k) => {
          if (typeof d[k] === "number") d[k] += (Math.random() - 0.5) * 2;
        });
        if (window._pushChartData) window._pushChartData(jitterFrame);
      }, 100);
    } else {
      highloadBtn.textContent = "🚀 x10 Load";
      highloadBtn.style.background = "transparent";
      clearInterval(window._highloadInterval);
    }
  });

  // ---- Simulate failure (manual demo override) ----
  const failureBtn = document.getElementById("simulate-failure-btn");
  failureBtn.addEventListener("click", () => {
    isFailureMode = !isFailureMode;

    if (isFailureMode) {
      document.body.classList.add("critical-mode");
      applyHealthIndex(47, "D");
      applyAlerts([
        {
          code: "E001",
          severity: "critical",
          message: "Перегрев ТЭД",
          value: 178,
        },
        {
          code: "E002",
          severity: "warning",
          message: "Падение давления ТМ",
          value: 320,
        },
      ]);
      nodes.engine.className = "schema-node status-crit";
      nodes.engine.textContent = "🔥 Двигатель (Отказ)";
      failureBtn.innerHTML = "✅ Restore System";
      failureBtn.style.borderColor = "var(--status-norm)";
      failureBtn.style.color = "var(--status-norm)";
    } else {
      isFailureMode = false;
      document.body.classList.remove("critical-mode");
      if (lastFrame) applyFrame(lastFrame);
      failureBtn.innerHTML = "🔥 Simulate Failure";
      failureBtn.style.borderColor = "var(--status-crit)";
      failureBtn.style.color = "var(--status-crit)";
    }
  });

  // ---- Export ----
  const exportDropdownBtn = document.getElementById("export-dropdown-btn");
  const exportCsvBtn = document.getElementById("export-csv");
  const exportPdfBtn = document.getElementById("export-pdf");

  exportDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    exportDropdownBtn.parentElement.classList.toggle("show");
  });
  window.addEventListener("click", () => {
    exportDropdownBtn.parentElement.classList.remove("show");
  });

  function showExportSuccess() {
    const orig = exportDropdownBtn.innerHTML;
    exportDropdownBtn.innerHTML = "✅ Сохранено";
    exportDropdownBtn.style.background = "#00e676";
    exportDropdownBtn.style.color = "#000";
    setTimeout(() => {
      exportDropdownBtn.innerHTML = orig;
      exportDropdownBtn.style.background = "var(--ktz-blue)";
      exportDropdownBtn.style.color = "#fff";
    }, 2000);
  }

  // CSV: fetch from backend, fall back to local buffer
  exportCsvBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const now = new Date();
      const from = new Date(now - 60 * 60 * 1000);
      const url = `${BACKEND_HTTP}/api/export?from=${from.toISOString()}&to=${now.toISOString()}&format=csv`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `KTZ_Telemetry_${Date.now()}.csv`;
      link.click();
      showExportSuccess();
    } catch {
      // Fallback: export local chart buffer
      let csv = "Время,Скорость (км/ч),Температура ТЭД (°C)\n";
      for (let i = 0; i < fullTime.length; i++)
        csv += `${fullTime[i]},${fullSpeed[i]},${fullTemp[i]}\n`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }),
      );
      link.download = `KTZ_Telemetry_local_${Date.now()}.csv`;
      link.click();
      showExportSuccess();
    }
  });

  // PDF: client-side from chart buffer (jsPDF)
  exportPdfBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setTextColor(0, 163, 224);
    doc.text("KTZ Loco-Twin Telemetry Report", 14, 22);
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
    if (lastFrame) {
      doc.text(
        `Locomotive: ${lastFrame.locomotive_id} (${lastFrame.locomotive_type})`,
        14,
        36,
      );
      doc.text(
        `Health Index: ${lastFrame.health_index} (${lastFrame.health_category})`,
        14,
        42,
      );
    }
    const body = [];
    for (let i = 0; i < fullTime.length; i++) {
      const t = fullTemp[i];
      const status = t >= 180 ? "CRITICAL" : t >= 155 ? "WARNING" : "NORMAL";
      body.push([fullTime[i], fullSpeed[i], fullTemp[i], status]);
    }
    doc.autoTable({
      startY: 50,
      head: [["Время", "Скорость (км/ч)", "Темп. ТЭД (°C)", "Статус"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [0, 163, 224] },
      didParseCell(data) {
        if (data.section === "body" && data.column.index === 3) {
          if (data.cell.raw === "CRITICAL") {
            data.cell.styles.textColor = [239, 68, 68];
            data.cell.styles.fontStyle = "bold";
          } else if (data.cell.raw === "WARNING") {
            data.cell.styles.textColor = [234, 179, 8];
          }
        }
      },
    });
    doc.save(`KTZ_Report_${Date.now()}.pdf`);
    showExportSuccess();
  });

  // ---- Theme ----
  const themeToggleBtn = document.getElementById("theme-toggle-btn");

  function applyChartTheme() {
    const isLight = document.body.classList.contains("light-mode");
    const textColor = isLight ? "#4b5563" : "#a1a1aa";
    const gridColor = isLight ? "#e5e7eb" : "#222";
    const ttBg = isLight ? "rgba(255,255,255,0.95)" : "rgba(10,11,14,0.9)";
    const ttText = isLight ? "#111827" : "#fff";
    myChart.setOption({
      tooltip: {
        backgroundColor: ttBg,
        borderColor: gridColor,
        textStyle: { color: ttText },
      },
      legend: { textStyle: { color: textColor } },
      xAxis: { axisLabel: { color: textColor } },
      yAxis: [
        {
          splitLine: { lineStyle: { color: gridColor } },
          axisLabel: { color: textColor },
        },
        { axisLabel: { color: textColor } },
      ],
    });
  }

  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light-mode");
    themeToggleBtn.innerHTML = "🌙 Dark";
  }
  applyChartTheme();

  themeToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("light-mode");
    const isLight = document.body.classList.contains("light-mode");
    localStorage.setItem("theme", isLight ? "light" : "dark");
    themeToggleBtn.innerHTML = isLight ? "🌙 Dark" : "☀️ Light";
    applyChartTheme();
  });

  // ---- Tabs (Trends / Map) ----
  const tabTrends = document.getElementById("tab-trends");
  const tabMap = document.getElementById("tab-map");
  const chartContainer = document.getElementById("main-chart");
  const mapContainer = document.getElementById("map-container");
  const mapControls = document.getElementById("map-controls");
  const replayPanel = document.getElementById("replay-panel");
  const liveBadge = document.getElementById("chart-live-badge");

  let map, trainMarker, routeLine;

  const stationsData = {
    astana: [51.1282, 71.4304],
    almaty: [43.2389, 76.8897],
    karaganda: [49.8019, 73.0858],
    pavlodar: [52.2833, 76.9667],
  };
  const railwayRoutes = {
    "astana-karaganda": [
      [51.1282, 71.4304],
      [50.846, 72.046],
      [50.568, 72.567],
      [50.06, 72.96],
      [49.8019, 73.0858],
    ],
    "astana-pavlodar": [
      [51.1282, 71.4304],
      [51.62, 73.1],
      [51.72, 75.32],
      [52.2833, 76.9667],
    ],
    "karaganda-almaty": [
      [49.8019, 73.0858],
      [48.8115, 73.5303],
      [46.8456, 74.9814],
      [43.6028, 73.7606],
      [43.2389, 76.8897],
    ],
  };

  function initMap() {
    if (map) return;
    map = L.map("map-container").setView(stationsData.astana, 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 18,
    }).addTo(map);
    const trainIcon = L.divIcon({
      html: "🚂",
      className: "train-icon",
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    trainMarker = L.marker(stationsData.astana, { icon: trainIcon }).addTo(map);
    drawRoute();
  }

  function drawRoute() {
    if (!map) return;
    const a = document.getElementById("station-a").value;
    const b = document.getElementById("station-b").value;
    const route =
      railwayRoutes[`${a}-${b}`] ||
      (railwayRoutes[`${b}-${a}`]
        ? [...railwayRoutes[`${b}-${a}`]].reverse()
        : [stationsData[a], stationsData[b]]);
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(route, {
      color: "#00A3E0",
      weight: 4,
      dashArray: "10,10",
    }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
    trainMarker.setLatLng(stationsData[a]);
  }

  // Update map marker from live GPS
  function updateMapMarker(lat, lon) {
    if (!trainMarker || lat == null || lon == null) return;
    trainMarker.setLatLng([lat, lon]);
  }
  window._updateMapMarker = updateMapMarker;

  document.getElementById("station-a").addEventListener("change", drawRoute);
  document.getElementById("station-b").addEventListener("change", drawRoute);

  tabTrends.addEventListener("click", () => {
    tabTrends.className = "btn primary-btn";
    tabMap.className = "btn outline-btn";
    mapContainer.style.display = "none";
    mapControls.style.display = "none";
    chartContainer.style.display = "block";
    replayPanel.style.display = "flex";
    myChart.resize();
  });

  tabMap.addEventListener("click", () => {
    tabMap.className = "btn primary-btn";
    tabTrends.className = "btn outline-btn";
    chartContainer.style.display = "none";
    replayPanel.style.display = "none";
    mapControls.style.display = "flex";
    mapContainer.style.display = "block";
    initMap();
    setTimeout(() => map.invalidateSize(), 100);
  });

  window.addEventListener("resize", () => {
    if (chartContainer.style.display !== "none") myChart.resize();
  });

  // ---- BOOT ----
  setConnectionStatus(false);
  startSyncTicker();
  connectWS();
});

// ============================================================
// CHART VIEW RENDERER (called after every data push)
// ============================================================

function updateChartView(myChart) {
  if (!myChart) return;
  const n = fullTime.length;
  const end = Math.min(viewEnd, n);
  const start = Math.max(0, end - WINDOW_SIZE);

  const curTime = fullTime.slice(start, end);
  const curSpeed = fullSpeed.slice(start, end);
  const curTemp = fullTemp.slice(start, end);
  const curPredict = fullPredict.slice(start, end);

  const isLive = end === n && !isPaused;
  const liveBadge = document.getElementById("chart-live-badge");
  const timelineStatus = document.getElementById("timeline-status");

  if (liveBadge) {
    liveBadge.textContent = isLive ? "LIVE" : isPaused ? "PAUSED" : "REPLAY";
    liveBadge.style.color = isLive ? "var(--status-crit)" : "var(--text-muted)";
  }
  if (timelineStatus) {
    if (isLive) {
      timelineStatus.textContent = "LIVE";
      timelineStatus.style.color = "var(--status-norm)";
    } else {
      const secsAgo = n - end;
      timelineStatus.textContent = `HISTORY: -${secsAgo}s`;
      timelineStatus.style.color = "var(--status-warn)";
    }
  }

  myChart.setOption({
    xAxis: { data: curTime },
    series: [
      { data: curSpeed, itemStyle: { color: isLive ? "#00A3E0" : "#8e8e93" } },
      { data: curTemp },
      {
        data: curPredict,
        lineStyle: { opacity: curPredict.some((v) => v !== null) ? 1 : 0 },
      },
    ],
  });

  // Update map marker from latest GPS in buffer
  if (lastFrame && lastFrame.data) {
    if (window._updateMapMarker) {
      window._updateMapMarker(
        lastFrame.data.latitude,
        lastFrame.data.longitude,
      );
    }
  }
}
