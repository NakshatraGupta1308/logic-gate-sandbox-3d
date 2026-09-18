import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { useCircuitStore } from '../state/circuitStore'
import { Workbench } from './Workbench'
import { GateMesh } from './GateMesh'
import { WireCurve } from './WireCurve'
import { computeSceneExtent, pinPosition } from './layout'
import { buildWireCurve } from './wireCurve3d'

function WireDragController() {
  useEffect(() => {
    function handlePointerUp() {
      const state = useCircuitStore.getState()
      if (!state.pendingWireFrom) return
      if (state.hoveredPin && !state.hoveredPin.isOutput) {
        state.completeWireDrag(state.hoveredPin)
      } else {
        state.cancelWireDrag()
      }
      state.setInteracting(false)
    }
    window.addEventListener('pointerup', handlePointerUp)
    return () => window.removeEventListener('pointerup', handlePointerUp)
  }, [])
  return null
}

function PendingWireLine() {
  const pendingWireFrom = useCircuitStore((s) => s.pendingWireFrom)
  const dragPoint = useCircuitStore((s) => s.dragPoint)
  const gates = useCircuitStore((s) => s.gates)

  // Built once and mutated in place on every drag update (mousemove can
  // fire dozens of times a second), rather than allocating a fresh
  // geometry/material/Line for each point and leaking the previous ones.
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    const material = new THREE.LineDashedMaterial({
      color: '#facc15',
      dashSize: 0.1,
      gapSize: 0.08,
    })
    return new THREE.Line(geometry, material)
  }, [])

  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line],
  )

  if (!pendingWireFrom || !dragPoint) return null
  const fromGate = gates.find((g) => g.id === pendingWireFrom.gateId)
  if (!fromGate) return null

  const from = new THREE.Vector3(...pinPosition(fromGate, true, pendingWireFrom.pin))
  const to = new THREE.Vector3(...dragPoint)
  const curve = buildWireCurve(from, to)
  line.geometry.setFromPoints(curve.getPoints(16))
  line.computeLineDistances()

  return <primitive object={line} />
}

function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const resetViewToken = useCircuitStore((s) => s.resetViewToken)
  const isInteracting = useCircuitStore((s) => s.isInteracting)
  // Matches Workbench's own box size (see computeSceneExtent) so a large
  // circuit's walls are never closer than the camera is allowed to pull
  // back, which would otherwise clip through them.
  const boxHalfSize = useCircuitStore((s) => computeSceneExtent(s.gates))

  useEffect(() => {
    controlsRef.current?.reset()
  }, [resetViewToken])

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!isInteracting}
      makeDefault
      enablePan
      panSpeed={1.5}
      minDistance={2}
      // Kept at most boxHalfSize: a point within that radius of the origin
      // can never have any single coordinate exceed it either, so this
      // guarantees the camera can approach a wall but never end up outside
      // the box looking back in. computeSceneExtent's padding now scales
      // with the circuit's size, so this still leaves real room to frame a
      // gate near the edge of a big circuit instead of stopping right at it.
      maxDistance={boxHalfSize}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  )
}

export function SceneRoot() {
  const gates = useCircuitStore((s) => s.gates)
  const wires = useCircuitStore((s) => s.wires)
  const gateById = useMemo(() => new Map(gates.map((g) => [g.id, g])), [gates])

  return (
    <Canvas camera={{ position: [6, 5, 8], fov: 50 }}>
      <color attach="background" args={['#ffffff']} />
      {/* Flat ambient-forward lighting keeps toon shading bands crisp
          instead of washing them out with soft light. */}
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 8, 4]} intensity={0.9} />
      <directionalLight position={[-4, 5, -6]} intensity={0.3} />

      <CameraRig />
      <Workbench />
      {/* frames={1}: by default ContactShadows re-renders the entire scene
          into an offscreen depth buffer plus two blur passes on every single
          animation frame forever, whether or not anything moved - a second
          full scene render that scales with gate count and dominates frame
          time once a circuit has many gates. ContactShadows re-runs its
          render body (resetting its internal frame counter) on every React
          re-render of this component, which already happens whenever the
          circuit changes (gates/wires state updates), so frames={1} still
          refreshes the shadow on every real change without paying that cost
          on every animation frame while just orbiting the camera. */}
      <ContactShadows
        frames={1}
        position={[0, 0.003, 0]}
        opacity={0.35}
        scale={20}
        blur={2.2}
        far={3}
        resolution={512}
        color="#1f2430"
      />

      {gates.map((gate) => (
        <GateMesh key={gate.id} gate={gate} />
      ))}

      {wires.map((wire) => {
        const fromGate = gateById.get(wire.from.gateId)
        const toGate = gateById.get(wire.to.gateId)
        if (!fromGate || !toGate) return null
        return <WireCurve key={wire.id} wire={wire} fromGate={fromGate} toGate={toGate} />
      })}

      <PendingWireLine />
      <WireDragController />
    </Canvas>
  )
}
