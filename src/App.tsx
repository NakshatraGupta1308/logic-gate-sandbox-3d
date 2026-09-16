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
  }, [deleteSelected, cancelWireDrag, copySelected, cutSelected, pasteClipboard])

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
