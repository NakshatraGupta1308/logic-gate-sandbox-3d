# 3D Logic Gate Sandbox: Project Spec

## 1. Overview

A browser-based, interactive 3D playground for building digital logic circuits, similar to Logisim, but rendered and manipulated in 3D space, with a modern, tactile interaction model instead of a flat 2D grid.

**Goal:** Let a user place logic gates as physical 3D objects, wire them together with curved cables, toggle inputs, and watch signals visually propagate through the circuit in real time.

**Why it's different from existing tools:** Existing digital logic simulators (Logisim, CircuitVerse, etc.) are all 2D, schematic-style tools. This project treats the circuit as a physical workbench you orbit around, with cables that droop like real wires and signals that visibly travel along them.

---

## 2. Core Principles

- **Separate simulation from rendering.** The logic engine (gates, connections, propagation) is a pure data model with zero dependency on Three.js. The 3D scene is just a view layer on top of that model. This keeps the logic testable and makes the renderer swappable later.
- **Feel tactile, not schematic.** Gates are physical objects you drag/rotate. Wires are curves, not straight lines. Signals are animated, not just color states.
- **Stay usable despite being 3D.** Snapping (to a loose grid, and to pins when wiring) keeps the free camera from making the tool frustrating.

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| 3D rendering | React Three Fiber (Three.js + React) | Best balance of 3D power and manageable component/state code |
| 3D helpers | @react-three/drei | OrbitControls, drag handles, gizmos, text labels |
| App state | Zustand (or plain React context) | Lightweight, avoids Redux boilerplate for a project this size |
| Simulation engine | Custom, framework-agnostic TypeScript module | Topological sort + tick-based signal propagation |
| Language | TypeScript | Type safety for the gate/graph data model |
| Build tool | Vite | Fast dev server, minimal config, pairs well with R3F |
| Styling (UI chrome, not 3D scene) | Tailwind CSS | Quick to build toolbars/panels around the 3D canvas |
| Deployment | GitHub Pages / Vercel | Static hosting for a client-only app |

No backend is required for the MVP; everything runs client-side in the browser.

---

## 4. Architecture

```
/src
  /engine              # Pure logic simulation, no rendering deps
    Gate.ts             # Gate types (AND, OR, NOT, INPUT, OUTPUT, XOR...)
    Circuit.ts           # Graph of gates + connections
    simulate.ts           # Propagation logic (topological sort + tick)
    types.ts

  /scene                # React Three Fiber components
    GateMesh.tsx          # 3D representation of a single gate
    WireCurve.tsx         # Curved cable between two pins, with signal pulse animation
    Workbench.tsx           # Camera, lighting, grid/snapping
    SceneRoot.tsx

  /state
    circuitStore.ts       # Zustand store bridging engine state <-> scene

  /ui
    Toolbar.tsx            # Gate palette, add/delete, save/load
    Inspector.tsx           # Selected gate/wire details

  App.tsx
  main.tsx
```

**Data flow:** User interacts with the 3D scene → updates the Zustand store → store mutates the engine's `Circuit` graph → `simulate.ts` runs a propagation pass → updated signal values flow back into the scene as animated pulses/colors.

---

## 5. Feature Requirements

### 5.1 MVP (v1): must have
- [ ] Place gates in 3D space: `INPUT`, `OUTPUT`, `AND`, `OR`, `NOT`
- [ ] Drag gates freely; snap to a loose 3D grid
- [ ] Click-and-drag from a pin to another pin to create a wire
- [ ] Wires render as curved (catenary or bezier) cables, not straight lines
- [ ] Toggle `INPUT` gates on click; `OUTPUT` gates reflect computed value
- [ ] Signal propagation: circuit re-evaluates on any input change
- [ ] Visual signal indication: wire color/glow change and/or a traveling pulse animation when a signal is HIGH
- [ ] Free camera: orbit, zoom, pan (via OrbitControls)
- [ ] Delete gates/wires

### 5.2 Stretch goals (v2+)
- [ ] Additional gate types: XOR, NAND, NOR, XNOR, D flip-flop
- [ ] Save/load circuits (localStorage first, JSON export/import next)
- [ ] Layered/stacked circuit building (place gates at different depths, "slide apart" view)
- [ ] Sound effects on toggle/propagation
- [ ] Guided tutorial mode (e.g., "build a half-adder")
- [ ] Shareable circuit links (encode circuit in URL or a backend)
- [ ] Undo/redo
- [ ] Multi-select and copy/paste of sub-circuits
- [ ] Custom user-defined "chips" (group a sub-circuit into a reusable component)

### 5.3 Explicitly out of scope for v1
- Multiplayer/collaborative editing
- Mobile/touch support (desktop-first for now)
- Backend/persistence beyond localStorage
- Analog or non-binary signal simulation

---

## 6. Simulation Engine Requirements

- Circuit represented as a directed graph: gates are nodes, wires are edges.
- Must detect and handle cycles gracefully (e.g., flip-flops later) without infinite loops. For v1, simply disallow feedback loops and validate on wire creation.
- Propagation approach: topological sort of the graph, evaluate each gate in order, one full pass per state change (event-driven, not a fixed clock loop, for v1).
- Each gate type is a pure function: `(inputs: boolean[]) => boolean`.
- Engine must be fully unit-testable independent of any 3D/rendering code.

---

## 7. Interaction / UX Requirements

- Dragging a gate should feel physical: smooth interpolation, no snapping jitter.
- Wire creation: hover highlights valid pins, click-drag from output pin to input pin, invalid connections (e.g., output-to-output) should be visually rejected.
- Camera should never get "lost"; provide a reset-view control.
- Toolbar/palette should be a simple 2D HTML overlay (not inside the 3D scene) for gate selection and circuit controls (clear, save, load).

---

## 8. Milestones

1. **Engine first:** Build and unit-test the simulation engine in isolation (no 3D yet): gates, wiring, propagation.
2. **Static 3D scene:** Render a hardcoded circuit in 3D (gates as meshes, wires as curves) to validate the visual approach.
3. **Interactivity:** Add drag-to-place, click-to-wire, click-to-toggle, hooked up to the engine via the store.
4. **Signal animation:** Add pulse/glow animation along wires driven by engine state.
5. **Polish pass:** Camera controls, snapping, delete, basic toolbar.
6. **Stretch features:** Pick from section 5.2 based on time remaining.

---

## 9. Resources

- React Three Fiber docs: https://docs.pmnd.rs/react-three-fiber
- @react-three/drei docs: https://github.com/pmndrs/drei
- Three.js docs: https://threejs.org/docs
- Zustand docs: https://github.com/pmndrs/zustand
- Reference for digital logic simulation approach: CircuitVerse (open source), https://github.com/CircuitVerse/CircuitVerse
- Bezier/catenary curve math for wire droop: Three.js `CatmullRomCurve3` or a custom catenary function

---

## 10. Repo Setup Notes (for Claude Code)

- Initialize with Vite + React + TypeScript template.
- Add Tailwind, React Three Fiber, drei, Zustand as initial dependencies.
- Set up the `/src/engine` module and its unit tests *before* touching any 3D code. This is the foundation everything else depends on.
- Suggested test framework: Vitest (pairs naturally with Vite).
- Keep commits scoped to milestones in section 8 for a clean history.
