import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { useCircuitStore } from '../state/circuitStore'
import { Workbench } from './Workbench'
import { GateMesh } from './GateMesh'
import { WireCurve } from './WireCurve'
import { buildWireCurve, pinPosition } from './layout'

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

  if (!pendingWireFrom || !dragPoint) return null
  const fromGate = gates.find((g) => g.id === pendingWireFrom.gateId)
  if (!fromGate) return null

  const from = new THREE.Vector3(...pinPosition(fromGate, true, pendingWireFrom.pin))
  const to = new THREE.Vector3(...dragPoint)
  const curve = buildWireCurve(from, to)
  const points = curve.getPoints(16)

  return <primitive object={makeDashedLine(points)} />
}

function makeDashedLine(points: THREE.Vector3[]): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineDashedMaterial({
    color: '#facc15',
    dashSize: 0.1,
    gapSize: 0.08,
  })
  const line = new THREE.Line(geometry, material)
  line.computeLineDistances()
  return line
}

function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const resetViewToken = useCircuitStore((s) => s.resetViewToken)
  const isInteracting = useCircuitStore((s) => s.isInteracting)

  useEffect(() => {
    controlsRef.current?.reset()
  }, [resetViewToken])

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!isInteracting}
      makeDefault
      minDistance={2}
      maxDistance={20}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  )
}

export function SceneRoot() {
  const gates = useCircuitStore((s) => s.gates)
  const wires = useCircuitStore((s) => s.wires)
  const gateById = new Map(gates.map((g) => [g.id, g]))

  return (
    <Canvas shadows camera={{ position: [6, 5, 8], fov: 50 }}>
      <color attach="background" args={['#0b0d12']} />
      <fog attach="fog" args={['#0b0d12', 12, 26]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[6, 8, 4]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-6, 4, -4]} intensity={0.3} color="#60a5fa" />

      <CameraRig />
      <Workbench />

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
