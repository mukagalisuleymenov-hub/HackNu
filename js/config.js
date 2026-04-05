// ============================================================
// CONFIG — constants & lookup tables
// ============================================================

const HOST = location.hostname || "localhost";

export const BACKEND_WS = `ws://${HOST}:8000/ws/live`;
export const BACKEND_HTTP = `http://${HOST}:8000`;

export const HEALTH_CATS = {
  A: { label: "СТАБИЛЬНО", risk: "Минимальный", color: "#22c55e" },
  B: { label: "Хорошо", risk: "Низкий", color: "#84cc16" },
  C: { label: "ВНИМАНИЕ", risk: "Умеренный", color: "#eab308" },
  D: { label: "ПРЕДУПРЕЖДЕНИЕ", risk: "Высокий", color: "#f97316" },
  E: { label: "КРИТИЧНО", risk: "ВЫСОКИЙ", color: "#ef4444" },
};

export const PARAM_LABELS = {
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

export const CATEGORY_PARAMS = {
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

export const WINDOW_SIZE = 60;
export const MAX_BUF = 1200;
