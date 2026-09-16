import { useEffect, useState } from 'react'
import { SceneRoot } from './scene/SceneRoot'
import { Toolbar } from './ui/Toolbar'
import { Inspector } from './ui/Inspector'
import { StartScreen } from './ui/StartScreen'
import { useCircuitStore } from './state/circuitStore'

function App() {
  const [started, setStarted] = useState(false)

  const deleteSelected = useCircuitStore((s) => s.deleteSelected)
  const cancelWireDrag = useCircuitStore((s) => s.cancelWireDrag)
  const copySelected = useCircuitStore((s) => s.copySelected)
  const cutSelected = useCircuitStore((s) => s.cutSelected)
  const pasteClipboard = useCircuitStore((s) => s.pasteClipboard)
  const undo = useCircuitStore((s) => s.undo)
  const redo = useCircuitStore((s) => s.redo)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      const withModifier = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

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
  }, [deleteSelected, cancelWireDrag, copySelected, cutSelected, pasteClipboard, undo, redo])

  if (!started) {
    return <StartScreen onStart={() => setStarted(true)} />
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      <SceneRoot />
      <div className="pointer-events-none absolute inset-0">
        <Toolbar />
        <Inspector />
      </div>
    </div>
  )
}

export default App
