import { lazy, Suspense, useEffect, useState } from 'react'
import { Toolbar } from './ui/Toolbar'
import { Inspector } from './ui/Inspector'
import { StartScreen } from './ui/StartScreen'
import { SceneRoot2D } from './scene2d/SceneRoot2D'
import { useCircuitStore } from './state/circuitStore'

// The 3D scene pulls in three.js/@react-three/fiber/drei, by far the
// heaviest part of the bundle. Loading it lazily means the start screen
// paints immediately, without waiting on or parsing that code at all until
// the user actually clicks Build. The 2D scene is plain SVG with no heavy
// dependencies, so it is imported eagerly and switches instantly.
const SceneRoot = lazy(() => import('./scene/SceneRoot').then((m) => ({ default: m.SceneRoot })))

function SceneLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-white">
      <div className="comic-card px-6 py-4 text-sm font-bold text-black">
        Loading workbench...
      </div>
    </div>
  )
}

function App() {
  const [started, setStarted] = useState(false)
  const viewMode = useCircuitStore((s) => s.viewMode)

  const deleteSelected = useCircuitStore((s) => s.deleteSelected)
  const cancelWireDrag = useCircuitStore((s) => s.cancelWireDrag)
  const copySelected = useCircuitStore((s) => s.copySelected)
  const cutSelected = useCircuitStore((s) => s.cutSelected)
  const pasteClipboard = useCircuitStore((s) => s.pasteClipboard)
  const selectAll = useCircuitStore((s) => s.selectAll)
  const undo = useCircuitStore((s) => s.undo)
  const redo = useCircuitStore((s) => s.redo)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      const withModifier = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (withModifier && key === 'a') {
        e.preventDefault()
        selectAll()
        return
      }
      if (withModifier && key === 'c') {
        e.preventDefault()
        copySelected()
        return
      }
      if (withModifier && key === 'x') {
        e.preventDefault()
        cutSelected()
        return
      }
      if (withModifier && key === 'v') {
        e.preventDefault()
        pasteClipboard()
        return
      }
      // Redo: Ctrl/Cmd+Shift+Z (standard everywhere) or Ctrl+Y (common on
      // Windows). Checked before plain undo since Shift+Z also matches "z".
      if (withModifier && e.shiftKey && key === 'z') {
        e.preventDefault()
        redo()
        return
      }
      if (e.ctrlKey && key === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (withModifier && key === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
        return
      }
      if (e.key === 'Escape') {
        cancelWireDrag()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelected, cancelWireDrag, copySelected, cutSelected, pasteClipboard, selectAll, undo, redo])

  if (!started) {
    return <StartScreen onStart={() => setStarted(true)} />
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      {viewMode === '3d' ? (
        <Suspense fallback={<SceneLoading />}>
          <SceneRoot />
        </Suspense>
      ) : (
        <SceneRoot2D />
      )}
      <div className="pointer-events-none absolute inset-0">
        <Toolbar />
        <Inspector />
      </div>
    </div>
  )
}

export default App
