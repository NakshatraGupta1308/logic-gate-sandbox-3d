import { useMemo } from 'react'
import * as THREE from 'three'

const MINOR_COLOR = '#d7dce3'
const MAJOR_COLOR = '#9aa3b0'
const MINOR_SPACING = 0.5
const MAJOR_SPACING = 2

/**
 * Builds a flat rectangular grid of line segments, `spacing` units apart,
 * centered on the local origin. THREE.GridHelper can't do this: it's
 * always a square. Lives in the local XY plane (normal +Z) so the same
 * geometry works for the floor or any wall, just rotated/positioned by
 * the parent group.
 */
function buildGridLines(width: number, height: number, spacing: number): THREE.BufferGeometry {
  const halfWidth = width / 2
  const halfHeight = height / 2
  const points: number[] = []

  for (let x = -halfWidth; x <= halfWidth + 1e-6; x += spacing) {
    points.push(x, -halfHeight, 0, x, halfHeight, 0)
  }
  for (let y = -halfHeight; y <= halfHeight + 1e-6; y += spacing) {
    points.push(-halfWidth, y, 0, halfWidth, y, 0)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return geometry
}

interface GridLinesProps {
  width: number
  height: number
}

/**
 * Just the graph-paper lines (fine minor under bold major), no backing
 * plane. Positioned/oriented by whatever group it's nested in; sits in the
 * local XY plane, facing +Z, nudged slightly toward the viewer along Z so
 * it doesn't z-fight with a plane placed at the same local origin.
 */
export function GridLines({ width, height }: GridLinesProps) {
  const minorGeometry = useMemo(() => buildGridLines(width, height, MINOR_SPACING), [width, height])
  const majorGeometry = useMemo(() => buildGridLines(width, height, MAJOR_SPACING), [width, height])

  return (
    <>
      <lineSegments geometry={minorGeometry} position={[0, 0, 0.001]}>
        <lineBasicMaterial color={MINOR_COLOR} />
      </lineSegments>
      <lineSegments geometry={majorGeometry} position={[0, 0, 0.002]}>
        <lineBasicMaterial color={MAJOR_COLOR} />
      </lineSegments>
    </>
  )
}

interface GridSurfaceProps {
  width: number
  height: number
  position: [number, number, number]
  rotation?: [number, number, number]
}

/**
 * A flat, unshaded rectangular panel with a graph-paper grid: GridLines
 * plus its own backing plane, for surfaces (the walls) that don't already
 * have one of their own to handle clicks.
 */
export function GridSurface({ width, height, position, rotation = [0, 0, 0] }: GridSurfaceProps) {
  return (
    <group position={position} rotation={rotation}>
      {/* DoubleSide: a wall only needs to be visible from inside the box,
          but the camera can graze right up against one, and it's one
          fewer thing to get the winding/rotation direction exactly right
          for across four different rotations. */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
      </mesh>
      <GridLines width={width} height={height} />
    </group>
  )
}
