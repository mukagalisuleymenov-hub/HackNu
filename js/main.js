// ============================================================
// MAIN — entry point, bootstraps the application
// ============================================================

import { initChart, pushChartData } from "./chart.js";
import { initControls } from "./controls.js";
import {
  connectWS,
  setConnectionStatus,
  setOnFrame,
  startSyncTicker,
} from "./websocket.js";

document.addEventListener("DOMContentLoaded", () => {
  // Init chart
  const chartDom = document.getElementById("main-chart");
  if (chartDom) initChart(chartDom);

  // Wire websocket frame → chart
  setOnFrame((frame) => pushChartData(frame));

  // Init all controls
  initControls();

  // Boot connection
  setConnectionStatus(false);
  startSyncTicker();
  connectWS();
});
