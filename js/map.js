// ============================================================
// MAP — Leaflet initialization, routes, marker
// ============================================================

let map = null;
let trainMarker = null;
let routeLine = null;

const STATIONS = {
  astana: [51.1282, 71.4304],
  almaty: [43.2389, 76.8897],
  karaganda: [49.8019, 73.0858],
  pavlodar: [52.2833, 76.9667],
};

const ROUTES = {
  "astana-karaganda": [
    [51.1282, 71.4304],
    [50.846, 72.046],
    [50.568, 72.567],
    [50.06, 72.96],
    [49.8019, 73.0858],
  ],
  "astana-pavlodar": [
    [51.1282, 71.4304],
    [51.62, 73.1],
    [51.72, 75.32],
    [52.2833, 76.9667],
  ],
  "karaganda-almaty": [
    [49.8019, 73.0858],
    [48.8115, 73.5303],
    [46.8456, 74.9814],
    [43.6028, 73.7606],
    [43.2389, 76.8897],
  ],
};

export function initMap() {
  if (map) return;
  const container = document.getElementById("map-container");
  if (!container) return;

  map = L.map(container).setView(STATIONS.astana, 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 18,
  }).addTo(map);

  const icon = L.divIcon({
    html: "🚂",
    className: "train-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
  trainMarker = L.marker(STATIONS.astana, { icon }).addTo(map);

  // Station markers
  Object.entries(STATIONS).forEach(([name, coords]) => {
    L.circleMarker(coords, {
      radius: 6,
      fillColor: "#00A3E0",
      color: "#fff",
      weight: 2,
      fillOpacity: 0.9,
    }).addTo(map);
  });

  drawRoute();
}

export function drawRoute() {
  if (!map) return;
  const a = document.getElementById("station-a")?.value || "astana";
  const b = document.getElementById("station-b")?.value || "karaganda";
  const key = `${a}-${b}`;
  const rev = `${b}-${a}`;
  const r =
    ROUTES[key] ||
    (ROUTES[rev] ? [...ROUTES[rev]].reverse() : [STATIONS[a], STATIONS[b]]);

  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline(r, {
    color: "#00A3E0",
    weight: 4,
    dashArray: "10,10",
  }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
  if (trainMarker) trainMarker.setLatLng(STATIONS[a]);
}

export function updateMapMarker(lat, lon) {
  if (trainMarker && lat != null && lon != null)
    trainMarker.setLatLng([lat, lon]);
}

export function invalidateMap() {
  if (map) setTimeout(() => map.invalidateSize(), 100);
}

// Expose for websocket frame updates
window._updateMapMarker = updateMapMarker;
