import { useEffect } from 'react'
import { SceneRoot } from './scene/SceneRoot'
import { Toolbar } from './ui/Toolbar'
import { Inspector } from './ui/Inspector'
import { useCircuitStore } from './state/circuitStore'

function App() {
  const deleteSelected = useCircuitStore((s) => s.deleteSelected)
  const cancelWireDrag = useCircuitStore((s) => s.cancelWireDrag)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        deleteSelected()
      }
      if (e.key === 'Escape') {
        cancelWireDrag()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelected, cancelWireDrag])

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
