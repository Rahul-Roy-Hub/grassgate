// Small geolocation helpers. Positions are { lat, lon, accuracy }.

const toPos = (p) => ({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });

const GEO_OPTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 };

function geoError(err) {
  const messages = {
    1: 'Location permission was denied.',
    2: 'Could not get a GPS fix.',
    3: 'Location timed out.',
  };
  return new Error(messages[err.code] || 'Location unavailable.');
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This browser has no geolocation.'));
    navigator.geolocation.getCurrentPosition((p) => resolve(toPos(p)), (e) => reject(geoError(e)), GEO_OPTS);
  });
}

// Returns a function that stops watching.
export function watchPosition(onPos, onError) {
  if (!('geolocation' in navigator)) {
    onError(new Error('This browser has no geolocation.'));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition((p) => onPos(toPos(p)), (e) => onError(geoError(e)), GEO_OPTS);
  return () => navigator.geolocation.clearWatch(id);
}

const rad = (d) => (d * Math.PI) / 180;

export function distanceM(a, b) {
  const R = 6371000;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

export const compass = (deg) => POINTS[Math.round(deg / 45) % 8];

// ~80 m per minute is an easy walking pace.
export const walkMinutes = (m) => Math.max(1, Math.round(m / 80));

export const formatDistance =(m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
