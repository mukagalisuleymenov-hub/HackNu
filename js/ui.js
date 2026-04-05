// ============================================================
// UI — DOM updates for health, alerts, stats, speed gauge
// ============================================================

import { HEALTH_CATS, PARAM_LABELS } from "./config.js";
import { state } from "./state.js";

const MAX_ALERT_HISTORY = 15;

// ---- Apply full frame ----
export function applyFrame(frame) {
  if (!frame) return;
  const data = frame.data || {};
  if (frame.locomotive_type) state.currentLocoType = frame.locomotive_type;

  updateLocoLabel(frame);
  applyHealthIndex(frame.health_index, frame.health_category);
  if (!state.activeCategory) renderLiveFactors(frame.health_factors || []);
  applySchemaNodes(frame.alerts || [], data);
  applyAlerts(frame.alerts || []);
  applySpeedGauge(data.speed ?? 0);
  applyStatCards(data, state.currentLocoType);

  // Store previous data for trend arrows
  state.prevData = { ...data };
}

// ---- Loco label ----
function updateLocoLabel(frame) {
  const id = document.getElementById("loco-id");
  const type = document.getElementById("loco-type");
  if (id) id.textContent = frame.locomotive_id || "—";
  if (type) type.textContent = frame.locomotive_type || "—";
}

// ---- Health index with smooth counter ----
export function applyHealthIndex(index, category) {
  if (index == null) return;
  const cat = HEALTH_CATS[category] || HEALTH_CATS.A;
  const scoreEl = document.getElementById("health-score");
  const labelEl = document.getElementById("health-label");
  const ringEl = document.getElementById("health-ring-fill");
  if (!scoreEl) return;

  if (state.healthRafId) cancelAnimationFrame(state.healthRafId);
  const start = state.healthDisplayed ?? index;
  const target = Math.round(index);
  const delta = target - start;
  const steps = 20;
  let step = 0;

  function tick() {
    step++;
    const eased = start + delta * (1 - Math.pow(1 - step / steps, 3));
    state.healthDisplayed = eased;
    scoreEl.textContent = Math.round(eased);
    if (step < steps) state.healthRafId = requestAnimationFrame(tick);
    else state.healthDisplayed = target;
  }
  state.healthRafId = requestAnimationFrame(tick);

  scoreEl.style.color = cat.color;

  if (ringEl) {
    const circumference = 2 * Math.PI * 54;
    const offset = circumference - (index / 100) * circumference;
    ringEl.style.strokeDasharray = circumference;
    ringEl.style.strokeDashoffset = offset;
    ringEl.style.stroke = cat.color;
  }

  if (labelEl) {
    labelEl.textContent = cat.label;
    labelEl.style.color = cat.color;
  }

  document.body.classList.toggle(
    "critical-mode",
    category === "E" || category === "D",
  );
}

// ---- Speed gauge (SVG arc) ----
export function applySpeedGauge(speed) {
  const numEl = document.getElementById("speed-num");
  const arcEl = document.getElementById("speed-arc-fill");
  if (!numEl) return;

  if (state.speedRafId) cancelAnimationFrame(state.speedRafId);
  const start = state.speedDisplayed;
  const target = Math.round(speed);
  const delta = target - start;
  const steps = 15;
  let step = 0;

  function tick() {
    step++;
    const eased = start + delta * (1 - Math.pow(1 - step / steps, 3));
    state.speedDisplayed = eased;
    numEl.textContent = Math.round(eased);
    if (step < steps) state.speedRafId = requestAnimationFrame(tick);
    else state.speedDisplayed = target;
  }
  state.speedRafId = requestAnimationFrame(tick);

  if (arcEl) {
    const maxSpeed = 160;
    const pct = Math.min(speed / maxSpeed, 1);
    const arcLength = (270 / 360) * 2 * Math.PI * 52;
    const offset = arcLength - pct * arcLength;
    arcEl.style.strokeDasharray = arcLength;
    arcEl.style.strokeDashoffset = offset;

    let color = "var(--ktz-blue)";
    if (speed > 120) color = "var(--status-crit)";
    else if (speed > 80) color = "var(--status-warn)";
    arcEl.style.stroke = color;
    numEl.style.color = color;
  }
}

// ---- Factors panel ----
export function renderLiveFactors(factors) {
  const container = document.getElementById("factors-container");
  if (!container) return;

  let html = "";
  if (state.activeCategory) {
    html += `<div class="factor-filter-bar">
      <span class="factor-filter-label">Фокус: ${state.activeCategory}</span>
      <button id="reset-filter-btn" class="chip-btn">✕ Сбросить</button>
    </div>`;
  }

  factors.forEach((f) => {
    const label = PARAM_LABELS[f.param] || f.param;
    const pct = Math.round(f.penalty * 100);
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
          <span class="factor-penalty" style="color:${color}">−${pct}</span>
        </div>
        <div class="factor-bar"><div class="factor-fill" style="width:${pct}%;background:${color};"></div></div>
      </div>`;
  });

  if (!factors.length) {
    html += `<div class="factors-ok">✅ Все параметры в норме</div>`;
  }

  container.innerHTML = html;
}

// ---- Schema nodes ----
export function applySchemaNodes(alerts, data) {
  const nodes = {
    power: document.getElementById("node-power"),
    engine: document.getElementById("node-engine"),
    brakes: document.getElementById("node-brakes"),
  };
  if (!nodes.power) return;

  nodes.power.className = "schema-node status-norm";
  nodes.engine.className = "schema-node status-norm";
  nodes.brakes.className = "schema-node status-norm";
  nodes.power.textContent =
    state.currentLocoType === "KZ8A" ? "⚡ Питание" : "⛽ Дизель";
  nodes.engine.textContent = "⚙️ Двигатель";
  nodes.brakes.textContent = "🛑 Тормоза";

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
    const key = nodeMap[a.code];
    if (!key) return;
    const cls = a.severity === "critical" ? "status-crit" : "status-warn";
    if (nodes[key].className.includes("status-norm"))
      nodes[key].className = `schema-node ${cls}`;
  });
}

// ---- Alerts with history ----
export function applyAlerts(alerts) {
  const currentBox = document.getElementById("dynamic-alert");
  const historyBox = document.getElementById("alert-history");

  // Push new alerts into history
  if (alerts.length) {
    const ts = new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    alerts.forEach((a) => {
      const last = state.alertHistory[0];
      if (last && last.code === a.code && last.message === a.message) return;
      state.alertHistory.unshift({ ...a, time: ts });
    });
    if (state.alertHistory.length > MAX_ALERT_HISTORY)
      state.alertHistory.length = MAX_ALERT_HISTORY;
  }

  if (!currentBox) return;

  if (!alerts.length) {
    currentBox.className = "alert-card norm-state";
    currentBox.style.borderLeft = "";
    currentBox.innerHTML = `
      <span class="alert-icon">✅</span>
      <div class="alert-content">
        <strong>Все системы в норме</strong>
        <p class="alert-sub">Отклонений не выявлено</p>
      </div>`;
  } else {
    const critical = alerts.filter((a) => a.severity === "critical");
    const top = critical[0] || alerts[0];
    const isCrit = top.severity === "critical";
    const color = isCrit ? "var(--status-crit)" : "var(--status-warn)";
    const icon = isCrit ? "🚨" : "⚠️";
    const others =
      alerts.length > 1
        ? `<p class="alert-sub" style="margin-top:4px;">+${alerts.length - 1} ещё</p>`
        : "";

    currentBox.className = isCrit
      ? "alert-card critical"
      : "alert-card warn-state";
    currentBox.style.borderLeft = `4px solid ${color}`;
    currentBox.innerHTML = `
      <span class="alert-icon">${icon}</span>
      <div class="alert-content">
        <strong style="color:${color}">[${top.code}] ${top.message}</strong>
        <p class="alert-val">Значение: <strong>${top.value}</strong></p>
        ${others}
      </div>`;
  }

  // Render history
  if (historyBox) {
    if (!state.alertHistory.length) {
      historyBox.innerHTML = '<p class="history-empty">Нет событий</p>';
      return;
    }
    historyBox.innerHTML = state.alertHistory
      .map((a) => {
        const dot = a.severity === "critical" ? "dot-crit" : "dot-warn";
        return `<div class="history-item">
        <span class="history-dot ${dot}"></span>
        <span class="history-time">${a.time}</span>
        <span class="history-code">${a.code}</span>
        <span class="history-msg">${a.message}</span>
        <span class="history-val">${a.value}</span>
      </div>`;
      })
      .join("");
  }
}

// ---- Stat cards with trend arrows ----
export function applyStatCards(data, locoType) {
  const bpp = data.brake_pipe_pressure;
  if (bpp != null) {
    const kgf = (bpp / 98.0665).toFixed(1);
    const color =
      bpp < 310
        ? "var(--status-crit)"
        : bpp < 450
          ? "var(--status-warn)"
          : "var(--text-main)";
    setStatValue("pressure", kgf, "кгс/см²", color);
    setTrend("pressure", bpp, state.prevData.brake_pipe_pressure);
  }

  if (locoType === "KZ8A") {
    const cv = data.catenary_voltage;
    if (cv != null) {
      const color =
        cv < 17 || cv > 29
          ? "var(--status-crit)"
          : cv < 19 || cv > 28
            ? "var(--status-warn)"
            : "var(--text-main)";
      setStatValue("voltage", cv.toFixed(1), "кВ", color);
      setStatLabel("voltage", "Напряжение КС");
      setTrend("voltage", cv, state.prevData.catenary_voltage);
    }
    const pwr = data.total_power_consumption;
    if (pwr != null) {
      setStatValue("fuel", Math.round(pwr), "кВт");
      setStatLabel("fuel", "Потребл. мощность");
      setTrend("fuel", pwr, state.prevData.total_power_consumption);
    }
  } else {
    const rpm = data.engine_rpm;
    if (rpm != null) {
      setStatValue("voltage", Math.round(rpm), "об/мин");
      setStatLabel("voltage", "Обороты двигателя");
      setTrend("voltage", rpm, state.prevData.engine_rpm);
    }
    const fl = data.fuel_level;
    const fr = data.fuel_consumption_rate;
    if (fl != null) {
      const color =
        fl < 5
          ? "var(--status-crit)"
          : fl < 15
            ? "var(--status-warn)"
            : "var(--text-main)";
      setStatValue("fuel", Math.round(fl), "%", color);
      setStatLabel("fuel", "Уровень топлива");
      setTrend("fuel", fl, state.prevData.fuel_level);
      const ctx = document.getElementById("fuel-context");
      if (ctx && fr != null) {
        const h = fr > 0 ? ((fl / fr) * 100).toFixed(0) : "—";
        ctx.textContent = `↓ ${Math.round(fr)} л/ч  ·  ~${h} ч.`;
      }
    }
  }
}

// Helpers
function setStatValue(id, value, unit, color) {
  const num = document.getElementById(`${id}-num`);
  const u = document.getElementById(`${id}-unit`);
  if (num) {
    num.textContent = value;
    if (color) num.style.color = color;
  }
  if (u) u.textContent = unit;
}

function setStatLabel(id, text) {
  const el = document.getElementById(`${id}-label`);
  if (el) el.textContent = text;
}

function setTrend(id, current, prev) {
  const el = document.getElementById(`${id}-trend`);
  if (!el || prev == null) return;
  const diff = current - prev;
  if (Math.abs(diff) < 0.1) {
    el.textContent = "—";
    el.className = "stat-trend trend-flat";
  } else if (diff > 0) {
    el.textContent = "▲";
    el.className = "stat-trend trend-up";
  } else {
    el.textContent = "▼";
    el.className = "stat-trend trend-down";
  }
}
