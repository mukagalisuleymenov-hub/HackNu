# Architecture: Locomotive Digital Twin Dashboard

> **Build Status**
>
> - ✅ Phase 0: Project setup complete
> - ✅ Phase 1: Backend skeleton — simulator running, WebSocket ingest live
> - ✅ Phase 2: Frontend MVP
> - ✅ Phase 3: Full dashboard panels
> - 🔲 Phase 4: History & replay
> - 🔲 Phase 5: Polish & hardening
> - 🔲 Phase 6: Dockerize

---

## Overview

Real-time telemetry dashboard for KZ8A (electric) and TE33A (diesel) locomotives operating on Kazakhstan's 1,520mm gauge network. Displays health index, live sensor data, alerts, route map, and historical replay.

---

## System Architecture

### Container Layout (Docker Compose)

| Service     | Image / Base               | Port | Role                                                                           |
| ----------- | -------------------------- | ---- | ------------------------------------------------------------------------------ |
| `simulator` | Python 3.11-slim           | —    | Generates telemetry at 1 Hz, connects to backend via WebSocket                 |
| `backend`   | Python 3.11-slim (FastAPI) | 8000 | Ingests telemetry, stores history, broadcasts to frontend via WebSocket + REST |
| `frontend`  | node:20-alpine (React)     | 3000 | Dashboard UI, WebSocket client, charts, map                                    |

### Data Flow

```
Simulator (Python, websockets)
    │
    │  WebSocket: ws://backend:8000/ws/ingest
    │  Sends 1 JSON message/sec (telemetry + health + alerts)
    ▼
FastAPI Backend
    ├── /ws/ingest          ← receives from simulator
    ├── Store to SQLite     ← INSERT each frame
    ├── /ws/live            → broadcasts to frontend (fan-out)
    ├── /api/history        → REST: query past data
    ├── /api/config         → REST: read/write thresholds
    └── /api/export         → REST: CSV/PDF report
                                    │
                                    ▼
                            React Dashboard
                            ├── WebSocket client ← live telemetry
                            ├── REST client ← history, replay, export
                            └── UI: gauges, charts, map, alerts
```

---

## Locomotive Types

### KZ8A — Electric (Alstom Prima)

- Manufacturer: Alstom / ЭКЗ (Астана)
- Power: 8,800 kW, two-section freight
- Power supply: 25 kV AC catenary → 1,800 V DC bus (IGBT converters)
- Max speed: 120 km/h, max tractive force: 833 kN
- Regenerative braking: 7,600 kW
- **Unique params**: catenary voltage, DC bus voltage, transformer oil temp, pantograph status, regen braking power, section coupling, converter (IGBT) temp

### TE33A — Diesel-Electric (GE Evolution)

- Manufacturer: GE Transportation / ЛКЗ (Астана)
- Engine: GEVO-12, 3,360 kW / 4,575 hp
- Traction: 6×560 kW async motors
- Max speed: 120 km/h, mass: 138 t
- **Unique params**: engine RPM (450–1050), fuel level, fuel consumption rate, coolant temp, oil pressure/temp, turbo boost, exhaust temp, throttle notch (0–8)

### Shared Parameters (Both Types)

Speed, brake pipe pressure, main reservoir pressure, brake cylinder pressure, traction motor temp/current, tractive effort, GPS position

---

## Telemetry Parameters & Thresholds

> **Note**: Thresholds are defined in `telemetry_config.json` (runtime-editable via `PUT /api/config/thresholds`). No recompile needed.

### Common

| Parameter               | Normal  | Warning | Critical | Unit |
| ----------------------- | ------- | ------- | -------- | ---- |
| Speed                   | 0–100   | 110     | 120      | km/h |
| Brake pipe pressure     | 480–540 | <450    | <310     | kPa  |
| Main reservoir pressure | 750–900 | <600    | <413     | kPa  |
| Traction motor temp     | 20–140  | 155     | 180      | °C   |
| Traction motor current  | 0–1000  | 1050    | 1150     | A    |

### Electric-Only (KZ8A)

| Parameter             | Normal    | Warning   | Critical  | Unit |
| --------------------- | --------- | --------- | --------- | ---- |
| Catenary voltage      | 21–27.5   | <19 / >28 | <17 / >29 | kV   |
| DC bus voltage        | 1600–1900 | >2000     | >2100     | V    |
| Transformer oil temp  | 30–85     | 95        | 105       | °C   |
| Converter temp (IGBT) | 20–70     | 80        | 90        | °C   |

### Diesel-Only (TE33A)

| Parameter             | Normal   | Warning | Critical | Unit |
| --------------------- | -------- | ------- | -------- | ---- |
| Engine RPM            | 450–1050 | —       | —        | rpm  |
| Coolant temp          | 75–95    | 100     | 105      | °C   |
| Oil pressure          | 280–550  | <200    | <140     | kPa  |
| Exhaust temp          | 200–550  | 600     | 650      | °C   |
| Fuel level            | 20–100   | <15     | <5       | %    |
| Fuel rate (idle/full) | 15 / 500 | —       | —        | L/h  |

---

## Health Index

### Formula

```
H = 100 - Σ(wᵢ × penaltyᵢ(xᵢ)) × 100
```

**Penalty function per parameter:**

- Within normal range → `penalty = 0`
- Between warning and critical → linearly scales from `0` to `1.0`
- Beyond critical → `penalty = 1.0`

### Weights

| Factor           | Weight |
| ---------------- | ------ |
| Brake system     | 25%    |
| Traction motors  | 20%    |
| Power system     | 20%    |
| Engine / thermal | 15%    |
| Speed compliance | 10%    |
| Fuel / energy    | 10%    |

### Categories

| Grade | Range  | Label          | Color  |
| ----- | ------ | -------------- | ------ |
| A     | 90–100 | Норма          | Green  |
| B     | 70–89  | Хорошо         | Lime   |
| C     | 50–69  | Внимание       | Yellow |
| D     | 25–49  | Предупреждение | Orange |
| E     | 0–24   | Критично       | Red    |

### Explainability

Each WebSocket frame includes `health_factors` — parameters contributing most to penalty:

```json
"health_factors": [
  {"param": "traction_motor_temp", "penalty": 0.85},
  {"param": "brake_pipe_pressure", "penalty": 0.32}
]
```

---

## WebSocket Message Format

The simulator sends self-contained messages. The backend forwards them to the frontend as-is (plus persists to DB).

```json
{
  "type": "telemetry",
  "timestamp": "2026-04-04T12:00:00.000Z",
  "locomotive_id": "KZ8A-0042",
  "locomotive_type": "KZ8A",
  "scenario": "Нормальный режим",
  "data": {
    "speed": 85.3,
    "brake_pipe_pressure": 510,
    "main_reservoir_pressure": 820,
    "traction_motor_temp": 95,
    "traction_motor_current": 680,
    "catenary_voltage": 25.1,
    "dc_bus_voltage": 1780,
    "transformer_oil_temp": 62,
    "converter_temp": 48,
    "tractive_effort": 420,
    "latitude": 51.1234,
    "longitude": 71.4567
  },
  "alerts": [
    {
      "code": "E001",
      "severity": "critical",
      "message": "Перегрев ТЭД",
      "value": 175
    }
  ],
  "health_index": 72,
  "health_category": "B",
  "health_factors": [{ "param": "traction_motor_temp", "penalty": 0.85 }]
}
```

---

## Simulator ✅ BUILT

**Files**: `simulator.py` (~250 lines), `simulator-Dockerfile`, `simulator-requirements.txt` (dep: `websockets`)

### How It Works

- Connects to backend via WebSocket at `/ws/ingest`
- Sends 1 JSON message per second (1 Hz)
- EMA smoothing per parameter: `value = value + (target - value) * 0.08 + noise`
- 0.5% sensor noise for realistic chart movement
- Auto-reconnect with 3s backoff
- GPS simulation along Astana → Karaganda rail corridor
- Health index + alerts computed locally (messages are self-contained)

### Scenario Loop (~6.5 min total)

| #   | Scenario               | Duration | What Happens                              |
| --- | ---------------------- | -------- | ----------------------------------------- |
| 1   | Нормальный режим       | 2 min    | Everything green, speed ramps to 85       |
| 2   | Тяжёлый состав, подъём | 1.5 min  | Speed 45, motor temp 145°C, Health → B    |
| 3   | Перегрев ТЭД           | 1 min    | Motor temp 175°C, alerts fire, Health → C |
| 4   | Экстренное торможение  | 30s      | Speed → 0, brake pressure spikes          |
| 5   | Восстановление         | 1.5 min  | Everything calms, Health → A              |

### CLI Usage

```bash
# Test without backend (prints JSON to stdout):
python simulator.py --console --type KZ8A

# Connect to backend:
python simulator.py --type KZ8A --url ws://localhost:8000/ws/ingest

# Diesel mode:
python simulator.py --type TE33A

# 2x speed for demo:
python simulator.py --speed 2
```

---

## Backend Architecture (FastAPI) ✅ SKELETON BUILT

> The simulator already computes health index and alerts. The backend's job is to receive, store, broadcast, and serve history. It does NOT recalculate health or run complex pipelines.

### Current File Layout

> **Note**: The project uses a flat layout under `backend/` rather than a nested `app/` package.

```
kzt-backend/
├── main.py
├── requirements.txt
├── simulator.py
├── simulator-requirements.txt
├── telemetry_config.json
├── docker-compose.yml
├── backend-Dockerfile
├── simulator-Dockerfile
├── routers/
│   ├── ws_ingest.py              — /ws/ingest ← simulator
│   ├── ws_live.py                — /ws/live → frontend
│   ├── history.py                🔲
│   ├── config_api.py             🔲
│   ├── export.py                 🔲
│   └── health_check.py           🔲
├── services/
│   ├── ws_manager.py             ✅ Fan-out logic
│   └── db.py                     🔲 aiosqlite wrapper
├── models/
│   └── telemetry.py              🔲 Pydantic schemas
├── config/
│   └── (loaded from telemetry_config.json)
```

> **Config**: Thresholds live in `telemetry_config.json` at the project root (not `config/thresholds.yaml` as originally planned). The `config_api.py` router should read/write this file.

### Key Endpoints

| Method | Path                                   | Status | Description                            |
| ------ | -------------------------------------- | ------ | -------------------------------------- |
| WS     | `/ws/ingest`                           | ✅     | Simulator pushes telemetry here        |
| WS     | `/ws/live`                             | ✅     | Frontend subscribes here for live data |
| GET    | `/api/history?from=&to=&params=`       | 🔲     | Query stored telemetry                 |
| GET    | `/api/history/replay?from=&to=&speed=` | 🔲     | Replay window at 1x–10x                |
| GET    | `/api/config/thresholds`               | 🔲     | Current threshold config               |
| PUT    | `/api/config/thresholds`               | 🔲     | Update thresholds at runtime           |
| GET    | `/api/export?from=&to=&format=csv`     | 🔲     | Export telemetry as CSV                |
| GET    | `/api/health`                          | 🔲     | Service liveness check                 |

### WebSocket Fan-Out

```python
class ConnectionManager:
    def __init__(self):
        self.clients: list[WebSocket] = []     # frontend connections
        self.ingest: WebSocket | None = None    # simulator connection

    async def broadcast(self, data: dict):
        """Send to all frontend clients, drop dead connections."""
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(data)
            except:
                dead.append(ws)
        for ws in dead:
            self.clients.remove(ws)
```

### Ingest Endpoint

```python
@router.websocket("/ws/ingest")
async def ws_ingest(ws: WebSocket):
    await ws.accept()
    manager.ingest = ws
    try:
        while True:
            raw = await ws.receive_text()
            frame = json.loads(raw)
            await db.insert(frame)             # persist
            await manager.broadcast(frame)     # fan-out to frontends
    except WebSocketDisconnect:
        manager.ingest = None
```

---

## Storage Schema (SQLite) 🔲

```sql
CREATE TABLE telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    locomotive_id TEXT NOT NULL,
    locomotive_type TEXT NOT NULL,
    scenario TEXT,
    speed REAL,
    brake_pipe_pressure REAL,
    main_reservoir_pressure REAL,
    traction_motor_temp REAL,
    traction_motor_current REAL,
    tractive_effort REAL,
    -- Electric (KZ8A) — NULL for diesel
    catenary_voltage REAL,
    dc_bus_voltage REAL,
    transformer_oil_temp REAL,
    converter_temp REAL,
    -- Diesel (TE33A) — NULL for electric
    engine_rpm REAL,
    coolant_temp REAL,
    oil_pressure REAL,
    exhaust_temp REAL,
    fuel_level REAL,
    fuel_rate REAL,
    throttle_notch INTEGER,
    -- Computed
    health_index REAL,
    health_category TEXT,
    latitude REAL,
    longitude REAL
);

CREATE INDEX idx_ts ON telemetry(timestamp);
CREATE INDEX idx_loco_ts ON telemetry(locomotive_id, timestamp);

CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    locomotive_id TEXT NOT NULL,
    code TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT,
    value REAL
);
```

### Retention

Hourly background task:

```sql
DELETE FROM telemetry WHERE timestamp < datetime('now', '-72 hours');
```

---

## Frontend Architecture (React) 🔲

### Component Tree

```
App
├── Header
│   ├── Locomotive ID + type badge (KZ8A / TE33A)
│   ├── Connection status (green dot / red dot)
│   └── Scenario label
├── HealthIndexWidget
│   ├── Large gauge (0–100, color by grade A–E)
│   ├── Grade letter + label (e.g., "B — Хорошо")
│   └── Top penalty factors list
├── DashboardGrid (adapts columns to locomotive type)
│   ├── SpeedGauge (0–120 km/h, redline at 110)
│   ├── BrakePanel (pipe + reservoir + cylinder pressures)
│   ├── TractionPanel (motor temp + current + effort)
│   ├── PowerPanel
│   │   ├── IF KZ8A: catenary V, DC bus V, IGBT temp, regen power
│   │   └── IF TE33A: RPM, coolant, oil pressure, exhaust, turbo
│   ├── FuelEnergyPanel
│   │   ├── IF KZ8A: energy consumption
│   │   └── IF TE33A: fuel level bar + consumption rate
│   └── AlertsPanel (scrollable, severity badges, timestamps)
├── TrendChart (full-width, multi-param selectable, zoom, 5-min window)
├── RouteMap (Leaflet, Astana–Karaganda corridor, current position)
└── ControlBar
    ├── ReplaySlider (last 5–15 min)
    ├── ExportButton (CSV)
    ├── LocomotiveTypeSwitcher (KZ8A / TE33A)
    └── ThemeToggle (light / dark)
```

### Tech Stack

| Concern   | Library                 | Why                              |
| --------- | ----------------------- | -------------------------------- |
| Charts    | Recharts or ECharts     | Auto-scaling, tooltips, zoom     |
| Map       | Leaflet + react-leaflet | Lightweight, no API key          |
| WebSocket | Native API              | Zero deps, manual reconnect      |
| State     | useState + useRef       | No Redux at this scale           |
| Styling   | Tailwind CSS            | Fast prototyping, `dark:` prefix |

### WebSocket Client

```javascript
function useTelemetrySocket(url) {
  const [frame, setFrame] = useState(null);
  const [status, setStatus] = useState("connecting");
  const wsRef = useRef(null);
  const retryRef = useRef(1000);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(url); // ws://localhost:8000/ws/live
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        retryRef.current = 1000;
      };
      ws.onmessage = (e) => setFrame(JSON.parse(e.data));
      ws.onclose = () => {
        setStatus("disconnected");
        setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, 30000);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => wsRef.current?.close();
  }, [url]);

  return { frame, status };
}
```

---

## Highload Handling (x10 Spike)

### Backend

- **Batched broadcast**: if frames arrive faster than 100ms apart, aggregate into one broadcast
- **Async everything**: `aiosqlite` for DB writes, no blocking in the event loop
- **Ring buffer**: last 1000 frames in-memory for instant replay without DB

### Frontend

- **requestAnimationFrame gating**: update React state on every message, but render charts at max 30fps
- **Chart windowing**: only render last 300 points, shift on new data
- **Debounced tooltips**: avoid recompute on every mouse event

---

## Security (Demo-Grade)

- Basic auth on `PUT /api/config/thresholds` via FastAPI `HTTPBasic`
- WebSocket `/ws/ingest` accepts only one connection (the simulator)
- All secrets via env vars: `AUTH_USER`, `AUTH_PASS`
- Swagger auto-generated at `/docs`

---

## Docker Compose ✅

```yaml
version: "3.8"

services:
  backend:
    build:
      context: .
      dockerfile: backend-Dockerfile
    ports:
      - "8000:8000"
    environment:
      - AUTH_USER=${AUTH_USER:-admin}
      - AUTH_PASS=${AUTH_PASS:-admin}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 10s
      retries: 3

  simulator:
    build:
      context: .
      dockerfile: simulator-Dockerfile
    environment:
      - LOCO_TYPE=KZ8A
      - WS_URL=ws://backend:8000/ws/ingest
      - SPEED=1
    depends_on:
      backend:
        condition: service_healthy

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend
```

> **Note**: Both `backend-Dockerfile` and `simulator-Dockerfile` live in `backend/` with a shared build context (`.`), rather than in separate subdirectories as originally planned.

---

## Build Order

### Phase 0: Setup ✅ DONE

Project structure created, deps installed, simulator running.

### Phase 1: Backend Skeleton ✅ DONE

Simulator connects, backend receives, stores (pending), broadcasts.

**Remaining in Phase 1:**

- [ ] `services/db.py` — aiosqlite wrapper + table init on startup
- [ ] `routers/health_check.py` — `GET /api/health` returns `{"status": "ok"}`
- [ ] Wire DB insert into the ingest handler

**Verify with:**

```bash
python simulator.py --type KZ8A --url ws://localhost:8000/ws/ingest
# In another terminal:
websocat ws://localhost:8000/ws/live
```

### Phase 2: Frontend MVP 🔲 NEXT

Goal: see live numbers on screen before touching anything else.

1. `hooks/useTelemetrySocket.js` — connect to `ws://localhost:8000/ws/live`
2. `App.jsx` — CSS grid layout shell
3. `HealthIndexWidget.jsx` — big number, color by grade (A–E)
4. `SpeedGauge.jsx` — number with color bar, redline at 110
5. `AlertsPanel.jsx` — scrollable list from `frame.alerts`
6. `TrendChart.jsx` — Recharts LineChart, keep last 60 points in state

**Checkpoint**: browser open, numbers updating, health index cycling through colors during the 6.5-min scenario loop. This is your demo. Everything after is polish.

### Phase 3: Full Dashboard Panels 🔲

7. `BrakePanel.jsx`
8. `TractionPanel.jsx`
9. `ElectricPowerPanel.jsx` (KZ8A only)
10. `DieselPowerPanel.jsx` (TE33A only)
11. `FuelEnergyPanel.jsx`
12. `RouteMap.jsx` — Leaflet, marker at GPS coords
13. Dark/light theme toggle

### Phase 4: History & Replay 🔲

14. `routers/history.py` — `GET /api/history?from=&to=`
15. `routers/export.py` — `GET /api/export?format=csv`
16. `ControlBar.jsx` — replay slider, time range, export

### Phase 5: Polish & Hardening 🔲

17. Connection status indicator
18. `routers/config_api.py` — read/write `telemetry_config.json` at runtime
19. Highload batching (100ms windows)
20. Ring buffer (last 1000 frames in memory)

### Phase 6: Dockerize 🔲

21. Verify all 3 Dockerfiles build cleanly
22. `docker-compose up` smoke test
23. Record demo with `--speed 2`

---

## Scoring Alignment

| Criteria      | Weight | What Covers It                                                                                                     |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| **UI/UX**     | 30%    | Health gauge A–E, type-conditional panels (KZ8A/TE33A), dark/light, Leaflet map, alert badges, Tailwind responsive |
| **Real-time** | 35%    | Direct WebSocket ingest + fan-out, reconnect with backoff, rAF gating, chart windowing, x10 batching               |
| **Backend**   | 25%    | Router separation, JSON config (no recompile), aiosqlite persistence, Swagger at /docs, health check               |
| **Demo**      | 10%    | Docker Compose one-command start, 5 scenario loop (6.5 min), `--speed 2` for fast demo                             |
