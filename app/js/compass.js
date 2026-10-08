// Live phone heading, so the walk arrow points where to go instead of staying north-up.

let active = null;

export const compassAvailable = () => 'DeviceOrientationEvent' in window;

// iOS asks for permission, and only from a tap.
export const needsPermission = () =>
  compassAvailable() && typeof DeviceOrientationEvent.requestPermission === 'function';

export async function startCompass(onHeading) {
  stopCompass();
  if (!compassAvailable()) return false;
  if (needsPermission() && (await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;

  const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;
  const handler = (e) => {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading; // iOS: clockwise from north
    else if (e.absolute && typeof e.alpha === 'number') heading = 360 - e.alpha; // Android: counter-clockwise
    if (heading != null) onHeading((heading + screenAngle() + 360) % 360);
  };
  const event = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(event, handler);
  active = { event, handler };
  return true;
}

export function stopCompass() {
  if (active) window.removeEventListener(active.event, active.handler);
  active = null;
}
