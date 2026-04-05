// ============================================================
// STATE — single source of truth for mutable app state
// ============================================================

export const state = {
  isPaused: false,
  isFailureMode: false,
  activeCategory: null,
  lastFrame: null,
  currentLocoType: "KZ8A",

  // Chart ring buffers
  viewEnd: 0,
  fullTime: [],
  fullSpeed: [],
  fullTemp: [],
  fullPredict: [],

  // WebSocket
  wsReconnectDelay: 1000,
  ws: null,
  lastMessageTime: null,
  syncTimerId: null,

  // Health animation
  healthDisplayed: null,
  healthRafId: null,

  // Highload
  highloadInterval: null,

  // Alert history (last 20)
  alertHistory: [],

  // Previous values for trend arrows
  prevData: {},

  // Speed gauge animation
  speedDisplayed: 0,
  speedRafId: null,
};
