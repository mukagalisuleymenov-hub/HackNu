# KTZ Digital Twin Backend

This repository contains the Digital Twin backend for locomotive telemetry, featuring a FastAPI server and a realistic telemetry simulator.

## Quick Start (Docker)

The easiest way to run the entire stack (Backend + Simulator) is using Docker Compose.

```bash
# Build and start the containers
docker compose up --build -d

# View logs to see telemetry flowing
docker compose logs -f
```

- **Backend API:** `http://localhost:8000`
- **Interactive Docs:** `http://localhost:8000/docs`
- **WebSocket Ingest:** `ws://localhost:8000/ws/ingest`

---

## Local Setup

### 1. Backend

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Simulator

The simulator generates realistic sensor data for **KZ8A** (electric) and **TE33A** (diesel) locomotives.

```bash
# Test without backend
python simulator.py --console --type KZ8A

# Connect to local backend:
python simulator.py --type KZ8A --url ws://localhost:8000/ws/ingest

# Custom settings:
python simulator.py --type TE33A --speed 2
```

---

## Using on Other Machines

Use one of these methods:

### Option 1: Ngrok (Public Internet)

If you have `ngrok` installed (found in the root folder):

1. Start the tunnel: `./ngrok http 8000`
2. Share the generated `https://xxxx.ngrok-free.app` link with your friend.
3. **Note:** If they are connecting a simulator/frontend, they must use the `wss://` prefix for WebSockets.

### Option 2: Local Network (Same Wi-Fi)

1. Find your IP: Run `ipconfig` in Windows (look for `192.168.x.x`).
2. Your friend can access the app at: `http://192.168.x.x:8000`.
3. Ensure **Windows Firewall** allows inbound traffic on port `8000`.

---

## Architecture

- **FastAPI:** Handles WebSocket ingestion, REST API for history, and live telemetry broadcasting.
- **SQLite:** Stores telemetry data in `telemetry.db`.
- **Simulator:** Multi-threaded Python script simulating locomotive physics and sensor jitter.
