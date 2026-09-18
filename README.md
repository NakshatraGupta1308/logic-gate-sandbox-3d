# Logic Gate Sandbox 3D

An interactive logic gate simulator: wire up gates on a virtual workbench and watch signals propagate in real time, in a full 3D scene or a live 2D schematic view.

**Live app:** https://nakshatragupta1308.github.io/logic-gate-sandbox-3d/

## Features

### Circuit building & simulation
- Place gates from a palette: `INPUT`, `OUTPUT`, `AND`, `OR`, `NOT`, `XOR`, `NAND`, `NOR`, `XNOR`, `BUFFER`, `MUX2` (2-to-1 multiplexer), and `DFF` (D flip-flop with real clocked/sequential behavior)
- Drag from an output pin to an input pin to wire gates together; double-click a wire to remove it
- Click an `INPUT` gate to toggle it and watch the whole circuit re-simulate instantly, including combinational cycle detection and correct clocked-sequential updates for flip-flops
- Drag gates to reposition them, with snap-to-grid placement
- Undo/redo (toolbar buttons or Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z)
- Select every gate and wire at once with Ctrl/Cmd+A and drag any one of them to move the whole circuit together, preserving its layout
- Save/load a circuit to the browser's local storage
- Built-in example circuits: Half Adder, Full Adder, and a 2-to-1 Mux
- The workbench and camera automatically grow to fit large or imported circuits, with enough room to comfortably pan/zoom out to any gate near the edge

### 3D view
- Full 3D scene built with React Three Fiber, with orbit/pan/zoom camera controls: drag to orbit, scroll (or a trackpad two-finger swipe) to pan freely, pinch or Ctrl/Cmd+scroll to zoom, or right-drag to pan
- Toon-shaded, comic-book-styled gates shaped like their real IEEE/ANSI schematic symbol (the same D-shape, shield, triangle, trapezoid, and inversion bubbles as the 2D view) instead of a generic box, with animated signal pulses along active wires and a graph-paper workbench with soft contact shadows
- Optimized rendering (careful use of drei's `Html` occlusion and `ContactShadows`) so large imported circuits (hundreds of gates) stay smooth

### 2D schematic view
- A live, fully interactive 2D top-down schematic (SVG-based) using standard IEEE/ANSI gate symbols, showing the exact same circuit and simulation state as the 3D view
- Pan and zoom, drag gates, and wire pins exactly as in 3D

### VHDL import
- Import a real, hand-written `.vhd`/`.vhdl` file and have it parsed into a live, simulated circuit, with clear line-numbered errors for anything unsupported (never a silent wrong result or a stack trace)
- Supports a substantial real-world VHDL subset:
  - `std_logic` and `std_logic_vector` ports/signals (including comma-separated declarations), expanded into one gate per bit
  - Indexed bit references and slices (`a(0)`, `y(3 downto 1)`), bit-string literals (`"0110"`), and hex literals (`X"e"`)
  - Concurrent assignments, `when`/`else` and `with`/`select` (selected signal assignment), and `(others => value)` aggregates
  - Combinational `process` blocks with `if`/`elsif`/`else` and `case`/`when` (both compiled to priority-mux logic)
  - Clocked processes (`if rising_edge(clk) then ...` or the `clk'event and clk = '1'` idiom), including nested conditions and register-with-enable ("hold when not assigned this edge") semantics
  - `integer range 0 to N` counters with real `+`/`-` arithmetic, synthesized as an actual ripple-carry adder/subtractor
  - Structural design: multiple `entity`/`architecture` pairs in one file, with `component`/`port map` instantiation (named or positional), flattened into one circuit
- Automatic left-to-right layered layout for imported circuits (VHDL carries no position information)

### VHDL export
- Export the current circuit as a dataflow-style `.vhd` file (entity/port declarations, concurrent signal assignments, and clocked processes for flip-flops), round-trippable back through VHDL import

### Schematic export
- **Export PDF:** a vector PDF schematic using standard gate symbols, laid out from the circuit's actual on-screen positions. A circuit too large to stay legible on one page is automatically tiled across a labeled grid of pages rather than being crushed into an unreadable single page
- **Export PNG:** the entire circuit as a single raster image at a resolution that scales to the circuit's size, with no page-size limit to split across

## Tech stack

- **[React 19](https://react.dev/)** + **[TypeScript](https://www.typescriptlang.org/)**, built with **[Vite](https://vite.dev/)**
- **[React Three Fiber](https://docs.pmnd.rs/react-three-fiber)** + **[drei](https://github.com/pmndrs/drei)** + **[three.js](https://threejs.org/)** for the 3D scene
- **[Zustand](https://zustand-demo.pmnd.rs/)** for application/circuit state
- **[Tailwind CSS](https://tailwindcss.com/)** for UI styling
- **[jsPDF](https://github.com/parallax/jsPDF)** for vector PDF schematic export
- A hand-written recursive-descent VHDL tokenizer/parser and gate-level circuit builder (no external VHDL library)
- **[Vitest](https://vitest.dev/)** for unit tests, **[oxlint](https://oxc.rs/docs/guide/usage/linter)** for linting
- Deployed to **GitHub Pages** via GitHub Actions on every push to `main`

## Getting started

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check and build for production
npm run test      # run the test suite
npm run lint      # lint with oxlint
npm run preview   # preview a production build locally
```

## License

MIT
