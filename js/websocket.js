// ============================================================
// WEBSOCKET — connection lifecycle & reconnect
// ============================================================

import { BACKEND_WS } from "./config.js";
import { state } from "./state.js";
import { applyFrame } from "./ui.js";

let onFrameCallback = null;

export function setOnFrame(cb) {
  onFrameCallback = cb;
}

export function connectWS() {
  state.ws = new WebSocket(BACKEND_WS);

  state.ws.onopen = () => {
    state.wsReconnectDelay = 1000;
    setConnectionStatus(true);
  };

  state.ws.onmessage = (e) => {
    state.lastMessageTime = Date.now();
    try {
      const frame = JSON.parse(e.data);
      state.lastFrame = frame;
      if (onFrameCallback) onFrameCallback(frame);
      if (!state.isPaused && !state.isFailureMode) applyFrame(frame);
    } catch (err) {
      console.warn("[WS] Parse error:", err);
    }
  };

  state.ws.onclose = () => {
    setConnectionStatus(false);
    setTimeout(connectWS, state.wsReconnectDelay);
    state.wsReconnectDelay = Math.min(state.wsReconnectDelay * 2, 30000);
  };

  state.ws.onerror = () => state.ws.close();
}

export function setConnectionStatus(online) {
  const dot = document.getElementById("conn-dot");
  const text = document.getElementById("conn-text");
  if (!dot || !text) return;

  if (online) {
    dot.className = "conn-dot online";
    text.textContent = "Подключено";
  } else {
    dot.className = "conn-dot offline";
    text.textContent = "Нет связи";
  }
}

export function startSyncTicker() {
  clearInterval(state.syncTimerId);
  state.syncTimerId = setInterval(() => {
    const el = document.getElementById("conn-latency");
    if (!el) return;
    if (!state.lastMessageTime) {
      el.textContent = "";
      return;
    }
    const ago = ((Date.now() - state.lastMessageTime) / 1000).toFixed(1);
    el.textContent = `${ago}s`;
    el.style.color = ago > 3 ? "var(--status-warn)" : "var(--text-muted)";
  }, 500);
}
