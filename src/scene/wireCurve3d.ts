import * as THREE from 'three'

/**
 * Kept out of layout.ts on purpose: it's the only thing in this whole
 * layout module that needs three.js, and layout.ts is also imported by the
 * eagerly-loaded 2D scene and the PDF export. Pulling THREE in there would
 * drag the full three.js bundle into paths that never render a single 3D
 * object.
 */
export function buildWireCurve(from: THREE.Vector3, to: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const distance = from.distanceTo(to)
  // Capped so cables droop visibly without dipping through the workbench
  // floor, since pins sit only GATE_HEIGHT/2 above it.
  const lowestPin = Math.min(from.y, to.y)
  const sag = Math.min(0.3, lowestPin * 0.8, 0.06 + distance * 0.05)
  const mid = new THREE.Vector3((from.x + to.x) / 2, lowestPin - sag, (from.z + to.z) / 2)
  return new THREE.QuadraticBezierCurve3(from, mid, to)
}
