"""
Locomotive Telemetry Simulator
Reads all parameter definitions, thresholds, and alert codes from telemetry_config.json.
Run:  python simulator.py --console --type KZ8A
      python simulator.py --type TE33A --url ws://localhost:8000/ws/ingest
"""

import asyncio
import json
import random
import signal
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

# ============================================================
# LOAD CONFIG — single source of truth
# ============================================================

CONFIG_PATH = Path(__file__).parent / "telemetry_config.json"
CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
TEL = CONFIG["telemetry_parameters"]


def _numeric_params(section_key):
    """Extract {name: {min, max, unit}} for non-enum params."""
    return {
        k: {"min": v["min"], "max": v["max"], "unit": v["unit"]}
        for k, v in TEL[section_key].items()
        if v.get("unit") != "enum" and "min" in v
    }


COMMON_PARAMS  = _numeric_params("common")
ELECTRIC_PARAMS = _numeric_params("electric_only")
DIESEL_PARAMS  = _numeric_params("diesel_only")


# ============================================================
# HEALTH INDEX — thresholds from config, weights per-param
# Config has category weights (brake_system: 0.25), but we need
# per-parameter weights. This mapping is simulator-specific.
# ============================================================

def _extract_threshold(spec):
    """Pull warning/critical from a config param spec. Returns dict or None."""
    if "warning" in spec and "critical" in spec:
        normal_hi = spec.get("normal_range", [0, spec["warning"]])[1]
        return {"normal": normal_hi, "warning": spec["warning"], "critical": spec["critical"]}
    if "warning_low" in spec and "critical_low" in spec:
        normal_lo = spec.get("normal_range", [spec["warning_low"], 0])[0]
        return {"normal": normal_lo, "warning": spec["warning_low"],
                "critical": spec["critical_low"], "invert": True}
    return None


def _build_thresholds(*section_keys):
    """Collect all params that have warning/critical into {param: threshold}."""
    out = {}
    for key in section_keys:
        for name, spec in TEL[key].items():
            t = _extract_threshold(spec)
            if t:
                out[name] = t
    return out


ALL_THRESHOLDS = _build_thresholds("common", "electric_only", "diesel_only")

# Per-parameter weights (not in config — config only has category-level weights)
PARAM_WEIGHTS = {
    # Common
    "brake_pipe_pressure":              0.15,
    "main_reservoir_pressure":          0.10,
    "traction_motor_temperature":       0.20,
    "traction_motor_current":           0.15,
    "speed":                            0.10,
    # Electric
    "transformer_oil_temperature":      0.10,
    "traction_converter_temperature":   0.10,
    # Diesel
    "engine_coolant_temperature":       0.10,
    "engine_oil_pressure":              0.05,
    "fuel_level":                       0.05,
    "exhaust_temperature":              0.05,
}

# Health categories from config
HEALTH_CATEGORIES = CONFIG["health_index"]["categories"]


def compute_penalty(value, threshold):
    """0.0 = normal, 1.0 = at/past critical."""
    normal, warning, critical = threshold["normal"], threshold["warning"], threshold["critical"]
    if threshold.get("invert"):
        if value >= normal:   return 0.0
        if value <= critical: return 1.0
        return 1.0 - (value - critical) / (normal - critical)
    else:
        if value <= normal:   return 0.0
        if value >= critical: return 1.0
        return (value - normal) / (critical - normal)


def calculate_health_index(data, loco_type):
    """Calculate health index 0–100 from current telemetry."""
    factors = []
    total_penalty = 0.0

    for param, threshold in ALL_THRESHOLDS.items():
        if param not in data or param not in PARAM_WEIGHTS:
            continue
        # Skip electric params for diesel and vice versa
        if param in ELECTRIC_PARAMS and loco_type != "KZ8A":
            continue
        if param in DIESEL_PARAMS and loco_type != "TE33A":
            continue

        penalty = compute_penalty(data[param], threshold)
        total_penalty += penalty * PARAM_WEIGHTS[param]
        if penalty > 0.05:
            factors.append({"param": param, "penalty": round(penalty, 2)})

    health = max(0, min(100, round(100 - total_penalty * 100)))

    category = "E"
    for cat, info in HEALTH_CATEGORIES.items():
        lo, hi = info["range"]
        if lo <= health <= hi:
            category = cat
            break

    factors.sort(key=lambda x: x["penalty"], reverse=True)
    return health, category, factors[:5]


# ============================================================
# ALERTS — built from config's alert_codes + param thresholds
# ============================================================

def _build_alert_rules():
    """Join alert_codes with parameter thresholds to get actionable rules."""
    rules = {}
    for code, info in CONFIG["alert_codes"].items():
        param = info["param"]
        # Find the param spec across all sections
        spec = None
        for section in ("common", "electric_only", "diesel_only"):
            if param in TEL[section]:
                spec = TEL[section][param]
                break
        if not spec:
            continue

        # Group by param: collect warning + critical codes
        if param not in rules:
            threshold = _extract_threshold(spec)
            if not threshold:
                continue
            rules[param] = {**threshold, "msg": info["message"], "codes": {}}

        rules[param]["codes"][info["severity"]] = code

    return rules


ALERT_RULES = _build_alert_rules()


def generate_alerts(data):
    """Check data against thresholds, return active alerts."""
    alerts = []
    for param, rule in ALERT_RULES.items():
        if param not in data:
            continue
        value = data[param]
        inverted = rule.get("invert", False)

        # Check critical first, then warning
        for severity in ("critical", "warning"):
            code = rule["codes"].get(severity)
            if not code:
                continue
            threshold_val = rule[severity]
            triggered = (value <= threshold_val) if inverted else (value >= threshold_val)
            if triggered:
                alerts.append({"code": code, "severity": severity,
                               "message": rule["msg"], "value": round(value, 1)})
                break  # don't double-fire warning if critical already matched
    return alerts


# ============================================================
# GPS — Astana → Karaganda corridor
# ============================================================

ROUTE_POINTS = [
    (51.1280, 71.4304), (51.0500, 71.6000), (50.9000, 71.9000),
    (50.7000, 72.3000), (50.4500, 72.8000), (50.2800, 73.1000),
    (49.9500, 73.3500), (49.8000, 73.1000),
]


def interpolate_gps(progress):
    n = len(ROUTE_POINTS) - 1
    idx = min(int(progress * n), n - 1)
    t = (progress * n) - idx
    lat = ROUTE_POINTS[idx][0] + t * (ROUTE_POINTS[idx + 1][0] - ROUTE_POINTS[idx][0])
    lon = ROUTE_POINTS[idx][1] + t * (ROUTE_POINTS[idx + 1][1] - ROUTE_POINTS[idx][1])
    return round(lat, 6), round(lon, 6)


# ============================================================
# SCENARIOS — these are simulator-specific, not in config
# ============================================================

def get_scenarios(loco_type):
    """Scripted scenarios that cycle during the demo."""

    # Common targets per scenario (uses config param names)
    base = [
        {"name": "Нормальный режим", "duration": 120, "targets": {
            "speed": 85, "brake_pipe_pressure": 510, "brake_cylinder_pressure": 0,
            "main_reservoir_pressure": 830, "traction_motor_temperature": 95,
            "traction_motor_current": 650, "tractive_effort": 350}},
        {"name": "Тяжёлый состав, подъём", "duration": 90, "targets": {
            "speed": 45, "brake_pipe_pressure": 500, "brake_cylinder_pressure": 0,
            "main_reservoir_pressure": 800, "traction_motor_temperature": 145,
            "traction_motor_current": 980, "tractive_effort": 700}},
        {"name": "Перегрев ТЭД", "duration": 60, "targets": {
            "speed": 35, "brake_pipe_pressure": 490, "brake_cylinder_pressure": 0,
            "main_reservoir_pressure": 780, "traction_motor_temperature": 175,
            "traction_motor_current": 1100, "tractive_effort": 600}},
        {"name": "Экстренное торможение", "duration": 30, "targets": {
            "speed": 0, "brake_pipe_pressure": 0, "brake_cylinder_pressure": 380,
            "main_reservoir_pressure": 600, "traction_motor_temperature": 110,
            "traction_motor_current": 0, "tractive_effort": 0}},
        {"name": "Восстановление после остановки", "duration": 90, "targets": {
            "speed": 60, "brake_pipe_pressure": 520, "brake_cylinder_pressure": 0,
            "main_reservoir_pressure": 850, "traction_motor_temperature": 80,
            "traction_motor_current": 500, "tractive_effort": 250}},
    ]

    # Type-specific target overrides per scenario
    if loco_type == "KZ8A":
        extras = [
            {"catenary_voltage": 25.2, "dc_bus_voltage": 1780, "transformer_oil_temperature": 55,
             "traction_converter_temperature": 45, "regen_braking_power": 0, "total_power_consumption": 5500},
            {"catenary_voltage": 24.5, "dc_bus_voltage": 1720, "transformer_oil_temperature": 78,
             "traction_converter_temperature": 65, "regen_braking_power": 0, "total_power_consumption": 7800},
            {"catenary_voltage": 24.0, "dc_bus_voltage": 1700, "transformer_oil_temperature": 92,
             "traction_converter_temperature": 82, "regen_braking_power": 0, "total_power_consumption": 8200},
            {"catenary_voltage": 25.0, "dc_bus_voltage": 1800, "transformer_oil_temperature": 70,
             "traction_converter_temperature": 55, "regen_braking_power": 5000, "total_power_consumption": 0},
            {"catenary_voltage": 25.3, "dc_bus_voltage": 1790, "transformer_oil_temperature": 50,
             "traction_converter_temperature": 40, "regen_braking_power": 0, "total_power_consumption": 3500},
        ]
    else:
        extras = [
            {"engine_rpm": 800, "engine_coolant_temperature": 85, "engine_oil_pressure": 420,
             "engine_oil_temperature": 88, "turbo_boost_pressure": 200, "exhaust_temperature": 380,
             "fuel_level": 75, "fuel_consumption_rate": 280, "throttle_position": 5},
            {"engine_rpm": 1020, "engine_coolant_temperature": 92, "engine_oil_pressure": 380,
             "engine_oil_temperature": 95, "turbo_boost_pressure": 270, "exhaust_temperature": 480,
             "fuel_level": 60, "fuel_consumption_rate": 450, "throttle_position": 8},
            {"engine_rpm": 1050, "engine_coolant_temperature": 102, "engine_oil_pressure": 300,
             "engine_oil_temperature": 108, "turbo_boost_pressure": 280, "exhaust_temperature": 620,
             "fuel_level": 50, "fuel_consumption_rate": 500, "throttle_position": 8},
            {"engine_rpm": 450, "engine_coolant_temperature": 88, "engine_oil_pressure": 350,
             "engine_oil_temperature": 85, "turbo_boost_pressure": 100, "exhaust_temperature": 200,
             "fuel_level": 48, "fuel_consumption_rate": 15, "throttle_position": 0},
            {"engine_rpm": 700, "engine_coolant_temperature": 82, "engine_oil_pressure": 440,
             "engine_oil_temperature": 80, "turbo_boost_pressure": 180, "exhaust_temperature": 320,
             "fuel_level": 45, "fuel_consumption_rate": 200, "throttle_position": 4},
        ]

    for scenario, ext in zip(base, extras):
        scenario["targets"].update(ext)

    return base


# ============================================================
# SIMULATION ENGINE
# ============================================================

class LocoSimulator:
    def __init__(self, loco_type="KZ8A", loco_id=None):
        self.loco_type = loco_type
        self.loco_id = loco_id or f"{loco_type}-{random.randint(1, 300):04d}"
        self.values = {}
        self.targets = {}
        self._init_defaults()

        self.scenarios = get_scenarios(loco_type)
        self.current_scenario_idx = 0
        self.scenario_timer = 0
        self.total_duration = sum(s["duration"] for s in self.scenarios)
        self.global_timer = 0
        self._apply_scenario(0)

    def _init_defaults(self):
        defaults = {
            "speed": 0, "brake_pipe_pressure": 520, "brake_cylinder_pressure": 0,
            "main_reservoir_pressure": 850, "traction_motor_temperature": 40,
            "traction_motor_current": 0, "tractive_effort": 0,
            "ambient_temperature": random.uniform(15, 30),
        }
        if self.loco_type == "KZ8A":
            defaults.update({"catenary_voltage": 25.0, "dc_bus_voltage": 1800,
                "transformer_oil_temperature": 35, "traction_converter_temperature": 30,
                "regen_braking_power": 0, "total_power_consumption": 0})
        else:
            defaults.update({"engine_rpm": 450, "engine_coolant_temperature": 60,
                "engine_oil_pressure": 450, "engine_oil_temperature": 55,
                "turbo_boost_pressure": 100, "exhaust_temperature": 150,
                "fuel_level": 95, "fuel_consumption_rate": 15, "throttle_position": 0})
        self.values = dict(defaults)
        self.targets = dict(defaults)

    def _apply_scenario(self, idx):
        self.targets.update(self.scenarios[idx]["targets"])
        self.scenario_timer = 0
        print(f"  → Сценарий: {self.scenarios[idx]['name']} "
              f"({self.scenarios[idx]['duration']}s)", file=sys.stderr)

    def _get_bounds(self):
        """Get param bounds for current loco type."""
        bounds = dict(COMMON_PARAMS)
        bounds.update(ELECTRIC_PARAMS if self.loco_type == "KZ8A" else DIESEL_PARAMS)
        return bounds

    def tick(self):
        """Advance 1 second. Returns telemetry message dict."""
        EMA = 0.08

        # 1. Move values toward targets
        for param in self.values:
            if param not in self.targets:
                continue
            target, current = self.targets[param], self.values[param]

            if param == "fuel_level":
                self.values[param] = max(0, current - random.uniform(0.01, 0.05))
            elif param == "throttle_position":
                self.values[param] = current + (1 if current < target else -1 if current > target else 0)
            else:
                noise = current * 0.005 * random.uniform(-1, 1)
                self.values[param] = current + (target - current) * EMA + noise

        # 2. Clamp to valid ranges
        for param, bounds in self._get_bounds().items():
            if param in self.values:
                self.values[param] = max(bounds["min"], min(bounds["max"], self.values[param]))

        # 3. Round for clean output
        data = {p: (int(v) if p == "throttle_position" else round(v, 1))
                for p, v in self.values.items()}

        # 4. GPS
        progress = (self.global_timer % self.total_duration) / self.total_duration
        data["latitude"], data["longitude"] = interpolate_gps(progress)

        # 5. Health + alerts
        health, category, factors = calculate_health_index(data, self.loco_type)
        alerts = generate_alerts(data)

        # 6. Build message
        message = {
            "type": "telemetry",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "locomotive_id": self.loco_id,
            "locomotive_type": self.loco_type,
            "scenario": self.scenarios[self.current_scenario_idx]["name"],
            "data": data,
            "alerts": alerts,
            "health_index": health,
            "health_category": category,
            "health_factors": factors,
        }

        # 7. Advance timers
        self.scenario_timer += 1
        self.global_timer += 1
        if self.scenario_timer >= self.scenarios[self.current_scenario_idx]["duration"]:
            self.current_scenario_idx = (self.current_scenario_idx + 1) % len(self.scenarios)
            self._apply_scenario(self.current_scenario_idx)

        return message


# ============================================================
# OUTPUT — WebSocket or console
# ============================================================

def _status_line(msg):
    d, h, cat = msg["data"], msg["health_index"], msg["health_category"]
    spd = d.get("speed", 0)
    alert_str = f" ⚠ {len(msg['alerts'])} alerts" if msg["alerts"] else ""
    return f"  [{cat}] Health={h:3d}  Speed={spd:5.1f}  {msg['scenario']}{alert_str}"


async def run_simulator(url, loco_type, loco_id, speed_multiplier):
    try:
        import websockets
    except ImportError:
        print("ERROR: pip install websockets"); sys.exit(1)

    sim = LocoSimulator(loco_type, loco_id)
    interval = 1.0 / speed_multiplier

    print(f"\n{'='*50}\n  Locomotive Telemetry Simulator\n"
          f"  Type: {loco_type} ({sim.loco_id})\n  Target: {url}\n"
          f"  Interval: {interval}s ({speed_multiplier}x)\n{'='*50}\n", file=sys.stderr)

    while True:
        try:
            print(f"Connecting to {url} ...", file=sys.stderr)
            async with websockets.connect(url) as ws:
                print("Connected!\n", file=sys.stderr)
                while True:
                    msg = sim.tick()
                    await ws.send(json.dumps(msg))
                    print(_status_line(msg), file=sys.stderr)
                    await asyncio.sleep(interval)
        except Exception as e:
            print(f"\nConnection lost: {e}\nReconnecting in 3s...\n", file=sys.stderr)
            await asyncio.sleep(3)


async def run_console_mode(loco_type, loco_id, speed_multiplier):
    sim = LocoSimulator(loco_type, loco_id)
    interval = 1.0 / speed_multiplier
    print(f"\n  CONSOLE MODE — {loco_type} ({sim.loco_id})\n", file=sys.stderr)

    while True:
        msg = sim.tick()
        print(_status_line(msg), file=sys.stderr)
        print(json.dumps(msg))
        await asyncio.sleep(interval)


# ============================================================
# ENTRY POINT
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Locomotive Telemetry Simulator")
    parser.add_argument("--type", choices=["KZ8A", "TE33A"], default="KZ8A")
    parser.add_argument("--id", default=None)
    parser.add_argument("--url", default="ws://localhost:8000/ws/ingest")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--console", action="store_true")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))

    if args.console:
        asyncio.run(run_console_mode(args.type, args.id, args.speed))
    else:
        asyncio.run(run_simulator(args.url, args.type, args.id, args.speed))


if __name__ == "__main__":
    main()