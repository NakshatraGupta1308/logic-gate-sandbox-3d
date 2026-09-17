import { useEffect, useState, type RefObject } from 'react'

/** Tracks an element's rendered pixel size via ResizeObserver. */
export function useElementSize(ref: RefObject<Element | null>) {
  const [size, setSize] = useState({ width: 1, height: 1 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width: Math.max(1, width), height: Math.max(1, height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return size
}
