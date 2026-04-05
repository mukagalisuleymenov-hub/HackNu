// ============================================================
// CONTROLS — buttons, tabs, theme, replay, highload, failure
// ============================================================

import {
  applyChartTheme,
  pushChartData,
  resizeChart,
  updateChartView,
} from "./chart.js";
import { BACKEND_HTTP, CATEGORY_PARAMS } from "./config.js";
import { exportCSV, exportPDF } from "./export.js";
import { drawRoute, initMap, invalidateMap } from "./map.js";
import { state } from "./state.js";
import {
  applyAlerts,
  applyFrame,
  applyHealthIndex,
  renderLiveFactors,
} from "./ui.js";

export function initControls() {
  // ── Schema node click filter ──
  const nodes = {
    power: document.getElementById("node-power"),
    engine: document.getElementById("node-engine"),
    brakes: document.getElementById("node-brakes"),
  };

  Object.keys(nodes).forEach((cat) => {
    if (!nodes[cat]) return;
    nodes[cat].addEventListener("click", () => {
      state.activeCategory = cat;
      Object.entries(nodes).forEach(([k, n]) => {
        if (!n) return;
        n.style.opacity = k === cat ? "1" : "0.35";
        n.style.transform = k === cat ? "scale(1.05)" : "scale(1)";
      });
      if (state.lastFrame) {
        const rel = (state.lastFrame.health_factors || []).filter((f) =>
          (CATEGORY_PARAMS[cat] || []).includes(f.param),
        );
        renderLiveFactors(
          rel.length ? rel : state.lastFrame.health_factors || [],
        );
      }
    });
  });

  // Reset filter via delegation
  document
    .getElementById("factors-container")
    ?.addEventListener("click", (e) => {
      if (e.target.id === "reset-filter-btn") {
        state.activeCategory = null;
        Object.values(nodes).forEach((n) => {
          if (n) {
            n.style.opacity = "1";
            n.style.transform = "scale(1)";
          }
        });
        if (state.lastFrame)
          renderLiveFactors(state.lastFrame.health_factors || []);
      }
    });

  // ── Play / Pause ──
  const playPauseBtn = document.getElementById("play-pause");
  playPauseBtn?.addEventListener("click", () => {
    state.isPaused = !state.isPaused;
    playPauseBtn.textContent = state.isPaused ? "▶ Play" : "⏸ Pause";
    if (!state.isPaused && state.lastFrame) applyFrame(state.lastFrame);
    updateChartView();
  });

  // Keyboard shortcut: space = pause/play
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      playPauseBtn?.click();
    }
  });

  // ── Timeline slider ──
  const slider = document.querySelector(".timeline-slider");
  if (slider) {
    slider.addEventListener("input", (e) => {
      state.isPaused = true;
      if (playPauseBtn) playPauseBtn.textContent = "▶ Play";
      state.viewEnd = parseInt(e.target.value);
      updateChartView();
      if (state.lastFrame) applyFrame(state.lastFrame);
    });
  }

  // ── Replay -5min ──
  const replayBtn = document.getElementById("replay-btn");
  replayBtn?.addEventListener("click", async () => {
    const now = new Date();
    const from = new Date(now - 5 * 60 * 1000);
    const url = `${BACKEND_HTTP}/api/history/replay?from=${from.toISOString()}&to=${now.toISOString()}&speed=4`;

    state.isPaused = true;
    if (playPauseBtn) playPauseBtn.textContent = "▶ Play";
    replayBtn.textContent = "⏳ Загрузка...";

    state.fullTime.length = 0;
    state.fullSpeed.length = 0;
    state.fullTemp.length = 0;
    state.fullPredict.length = 0;
    state.viewEnd = 0;

    try {
      const evtSrc = new EventSource(url);
      evtSrc.onmessage = (e) => {
        const frame = JSON.parse(e.data);
        pushChartData(frame);
        applyFrame(frame);
        state.viewEnd = state.fullTime.length;
        updateChartView();
      };
      evtSrc.onerror = () => {
        evtSrc.close();
        replayBtn.textContent = "⏪ −5 мин";
      };
      setTimeout(() => {
        evtSrc.close();
        replayBtn.textContent = "⏪ −5 мин";
      }, 70000);
    } catch {
      replayBtn.textContent = "⏪ −5 мин";
    }
  });

  // ── Jump to live ──
  window.jumpToLive = () => {
    state.isPaused = false;
    state.viewEnd = state.fullTime.length;
    if (playPauseBtn) playPauseBtn.textContent = "⏸ Pause";
    if (slider) slider.value = state.viewEnd;
    updateChartView();
  };

  // ── Highload ──
  const highloadBtn = document.getElementById("highload-btn");
  let highloadActive = false;
  highloadBtn?.addEventListener("click", () => {
    highloadActive = !highloadActive;
    if (highloadActive) {
      highloadBtn.textContent = "🛑 Стоп";
      highloadBtn.classList.add("active");
      state.highloadInterval = setInterval(() => {
        if (!state.lastFrame) return;
        const jf = JSON.parse(JSON.stringify(state.lastFrame));
        Object.keys(jf.data).forEach((k) => {
          if (typeof jf.data[k] === "number")
            jf.data[k] += (Math.random() - 0.5) * 2;
        });
        pushChartData(jf);
      }, 100);
    } else {
      highloadBtn.textContent = "🚀 x10";
      highloadBtn.classList.remove("active");
      clearInterval(state.highloadInterval);
    }
  });

  // ── Simulate failure ──
  const failureBtn = document.getElementById("simulate-failure-btn");
  failureBtn?.addEventListener("click", () => {
    state.isFailureMode = !state.isFailureMode;
    if (state.isFailureMode) {
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
      const eng = document.getElementById("node-engine");
      if (eng) {
        eng.className = "schema-node status-crit";
        eng.textContent = "🔥 Двигатель";
      }
      failureBtn.textContent = "✅ Восстановить";
      failureBtn.classList.add("restoring");
    } else {
      document.body.classList.remove("critical-mode");
      if (state.lastFrame) applyFrame(state.lastFrame);
      failureBtn.textContent = "🔥 Авария";
      failureBtn.classList.remove("restoring");
    }
  });

  // ── Export dropdown ──
  const exportBtn = document.getElementById("export-dropdown-btn");
  exportBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    exportBtn.parentElement.classList.toggle("show");
  });
  window.addEventListener("click", () =>
    exportBtn?.parentElement.classList.remove("show"),
  );

  function flashExportSuccess() {
    if (!exportBtn) return;
    const orig = exportBtn.innerHTML;
    exportBtn.innerHTML = "✅ Готово";
    setTimeout(() => {
      exportBtn.innerHTML = orig;
    }, 2000);
  }

  document
    .getElementById("export-csv")
    ?.addEventListener("click", async (e) => {
      e.preventDefault();
      await exportCSV();
      flashExportSuccess();
    });
  document.getElementById("export-pdf")?.addEventListener("click", (e) => {
    e.preventDefault();
    exportPDF();
    flashExportSuccess();
  });

  // ── Theme toggle ──
  const themeBtn = document.getElementById("theme-toggle-btn");
  function setTheme(light) {
    document.body.classList.toggle("light-mode", light);
    if (themeBtn) themeBtn.textContent = light ? "🌙" : "☀️";
    localStorage.setItem("theme", light ? "light" : "dark");
    applyChartTheme(light);
  }

  if (localStorage.getItem("theme") === "light") setTheme(true);
  themeBtn?.addEventListener("click", () => {
    setTheme(!document.body.classList.contains("light-mode"));
  });

  // ── Tabs: Trends / Map ──
  const tabTrends = document.getElementById("tab-trends");
  const tabMap = document.getElementById("tab-map");
  const chartContainer = document.getElementById("main-chart");
  const mapContainer = document.getElementById("map-container");
  const mapControls = document.getElementById("map-controls");
  const replayPanel = document.getElementById("replay-panel");

  tabTrends?.addEventListener("click", () => {
    tabTrends.className = "tab-btn active";
    tabMap.className = "tab-btn";
    if (mapContainer) mapContainer.style.display = "none";
    if (mapControls) mapControls.style.display = "none";
    if (chartContainer) chartContainer.style.display = "block";
    if (replayPanel) replayPanel.style.display = "flex";
    resizeChart();
  });

  tabMap?.addEventListener("click", () => {
    tabMap.className = "tab-btn active";
    tabTrends.className = "tab-btn";
    if (chartContainer) chartContainer.style.display = "none";
    if (replayPanel) replayPanel.style.display = "none";
    if (mapControls) mapControls.style.display = "flex";
    if (mapContainer) mapContainer.style.display = "block";
    initMap();
    invalidateMap();
  });

  document.getElementById("station-a")?.addEventListener("change", drawRoute);
  document.getElementById("station-b")?.addEventListener("change", drawRoute);

  // ── Resize ──
  window.addEventListener("resize", () => {
    if (chartContainer?.style.display !== "none") resizeChart();
  });
}
