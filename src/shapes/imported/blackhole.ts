import type { ImportedShapeDef } from '../types'

const TAU = Math.PI * 2

// Ported from the "BLACKHOLE" community formation by lachlan on
// particles.casberry.in (Firestore formation, Schwarzschild black hole).
// Static port: time frozen at 0, slider defaults baked in. Zone split by
// t = i/count — with our degree-desc index ordering, hubs land in the inner
// accretion disk (the hottest, densest region).
const SCALE = 55 // "Scale" slider default
const ACC_DENSITY = 1.2 // "Disk Density"
const JET_POWER = 1.4 // "Jet Power"
const LENS_STR = 0.8 // "Lens Warp"

export const blackhole: ImportedShapeDef = {
  id: 'blackhole',
  label: 'Black Hole',
  icon: '🕳️',
  source: 'particles.casberry.in community formation "BLACKHOLE" by lachlan (static port)',
  position(i, count) {
    const t = i / count

    if (t < 0.55) {
      // Accretion disk: quadratic radius from the photon sphere (r=1.5) outward
      const dLocalT = t / 0.55
      const dAngle = dLocalT * TAU * 37.0
      const dRadBase = 1.5 + dLocalT * dLocalT * 4.0 * ACC_DENSITY
      const dRad = dRadBase * (0.85 + 0.15 * Math.sin(dLocalT * 5.0))
      const dTilt = (dLocalT - 0.5) * 0.22
      const dY = Math.sin(dLocalT * TAU * 11.0) * 0.18 * dRadBase + dTilt
      return { x: Math.cos(dAngle) * dRad * SCALE, y: dY * SCALE, z: Math.sin(dAngle) * dRad * SCALE }
    }

    if (t < 0.72) {
      // Photon sphere: spherical shell at r≈1.5
      const pLocalT = (t - 0.55) / 0.17
      const pPhi = pLocalT * TAU * 23.0
      const pTheta = pLocalT * TAU * 7.0
      const pRad = 1.5 + Math.sin(pLocalT * TAU * 3.0) * 0.08
      return {
        x: Math.cos(pPhi) * Math.sin(pTheta) * pRad * SCALE,
        y: Math.cos(pTheta) * pRad * SCALE,
        z: Math.sin(pPhi) * Math.sin(pTheta) * pRad * SCALE,
      }
    }

    if (t < 0.84) {
      // Relativistic jets: bipolar, quadratic height, narrowing helix
      const jLocalT = (t - 0.72) / 0.12
      const jSide = jLocalT < 0.5 ? 1.0 : -1.0
      const jT = (jLocalT % 0.5) / 0.5
      const jHeight = jSide * (0.3 + jT * jT * 7.0 * JET_POWER)
      const jAngle = jT * TAU * 8.0
      const jRadius = (1.0 - jT) * 0.45 * JET_POWER + Math.sin(jT * TAU * 4.0) * 0.08
      return { x: Math.cos(jAngle) * jRadius * SCALE, y: jHeight * SCALE, z: Math.sin(jAngle) * jRadius * SCALE }
    }

    // Gravitational-lensing arcs: 6 arc families at different inclinations,
    // warped toward the center by an inverse-square falloff
    const lLocalT = (t - 0.84) / 0.16
    const lArcId = Math.floor(lLocalT * 6.0)
    const lArcT = (lLocalT * 6.0) % 1.0
    const lTilt = lArcId * 0.52 + 0.3
    const lAng = lArcT * TAU * (1.0 + lArcId * 0.3)
    const lRad = 2.2 + lArcId * 0.55 + Math.sin(lArcId) * 0.2
    const x0 = Math.cos(lAng) * lRad
    const y0 = Math.sin(lAng) * lRad * Math.sin(lTilt)
    const z0 = Math.sin(lAng) * lRad * Math.cos(lTilt)
    const lDist = Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0) + 0.001
    const lWarp = LENS_STR / (lDist * lDist + 0.8)
    return { x: x0 * (1 - lWarp) * SCALE, y: y0 * (1 - lWarp) * SCALE, z: z0 * (1 - lWarp) * SCALE }
  },
}
