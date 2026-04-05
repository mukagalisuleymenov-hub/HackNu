// ============================================================
// CHART — ECharts setup, data ring buffer, view rendering
// ============================================================

import { MAX_BUF, WINDOW_SIZE } from "./config.js";
import { state } from "./state.js";

let chart = null;

export function initChart(domEl) {
  chart = echarts.init(domEl);

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(10,11,14,0.92)",
      borderColor: "#333",
      textStyle: { color: "#fff", fontSize: 12 },
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

  return chart;
}

export function getChart() {
  return chart;
}

export function pushChartData(frame) {
  const data = frame.data || {};
  const d = new Date(frame.timestamp || Date.now());
  const ts = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

  const speed = data.speed ?? 0;
  const temp = data.traction_motor_temperature ?? 0;
  const prevT = state.fullTemp[state.fullTemp.length - 1];
  const predict =
    prevT != null && temp > prevT && temp > 130
      ? parseFloat((temp + (temp - prevT) * 3).toFixed(1))
      : null;

  state.fullTime.push(ts);
  state.fullSpeed.push(parseFloat(speed.toFixed(1)));
  state.fullTemp.push(parseFloat(temp.toFixed(1)));
  state.fullPredict.push(predict);

  if (state.fullTime.length > MAX_BUF) {
    state.fullTime.shift();
    state.fullSpeed.shift();
    state.fullTemp.shift();
    state.fullPredict.shift();
    if (state.viewEnd > 0) state.viewEnd--;
  }

  const slider = document.querySelector(".timeline-slider");
  if (slider) slider.max = state.fullTime.length;

  if (!state.isPaused) {
    state.viewEnd = state.fullTime.length;
    if (slider) slider.value = state.viewEnd;
  }

  updateChartView();
}

export function updateChartView() {
  if (!chart) return;
  const n = state.fullTime.length;
  const end = Math.min(state.viewEnd, n);
  const start = Math.max(0, end - WINDOW_SIZE);
  const isLive = end === n && !state.isPaused;

  // History banner
  const banner = document.getElementById("history-banner");
  if (banner) banner.style.display = isLive ? "none" : "flex";

  const liveBadge = document.getElementById("chart-live-badge");
  const timelineStatus = document.getElementById("timeline-status");

  if (liveBadge) {
    liveBadge.textContent = isLive
      ? "LIVE"
      : state.isPaused
        ? "ПАУЗА"
        : "REPLAY";
    liveBadge.className = `live-indicator ${isLive ? "is-live" : "is-paused"}`;
  }
  if (timelineStatus) {
    timelineStatus.textContent = isLive ? "LIVE" : `−${n - end}s`;
    timelineStatus.style.color = isLive
      ? "var(--status-norm)"
      : "var(--status-warn)";
  }

  chart.setOption({
    xAxis: { data: state.fullTime.slice(start, end) },
    series: [
      {
        data: state.fullSpeed.slice(start, end),
        itemStyle: { color: isLive ? "#00A3E0" : "#8e8e93" },
      },
      { data: state.fullTemp.slice(start, end) },
      {
        data: state.fullPredict.slice(start, end),
        lineStyle: {
          opacity: state.fullPredict.slice(start, end).some((v) => v !== null)
            ? 1
            : 0,
        },
      },
    ],
  });

  // Update map marker if available
  if (state.lastFrame?.data && window._updateMapMarker) {
    window._updateMapMarker(
      state.lastFrame.data.latitude,
      state.lastFrame.data.longitude,
    );
  }
}

export function applyChartTheme(isLight) {
  if (!chart) return;
  const tc = isLight ? "#4b5563" : "#a1a1aa";
  const gc = isLight ? "#e5e7eb" : "#222";
  chart.setOption({
    tooltip: {
      backgroundColor: isLight
        ? "rgba(255,255,255,0.95)"
        : "rgba(10,11,14,0.92)",
      borderColor: gc,
      textStyle: { color: isLight ? "#111827" : "#fff" },
    },
    legend: { textStyle: { color: tc } },
    xAxis: { axisLabel: { color: tc } },
    yAxis: [
      { splitLine: { lineStyle: { color: gc } }, axisLabel: { color: tc } },
      { axisLabel: { color: tc } },
    ],
  });
}

export function resizeChart() {
  if (chart) chart.resize();
}
