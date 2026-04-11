# Slime Mold Simulation — WebGPU

A real-time slime mold (Physarum polycephalum) simulation running entirely on the GPU via WebGPU compute shaders.

## Algorithm Overview

The simulation models the collective behavior of millions of simple agents that deposit, sense, and follow chemical trails — producing emergent organic patterns reminiscent of slime mold growth.

### 1. Agent Model

Each agent has three properties:
- **Position** (`x`, `y`) — floating-point location on the 2D trail map.
- **Rotation** (`θ`) — heading angle in radians.

### 2. Per-Frame Update Loop

Each simulation frame executes four GPU passes in sequence:

#### Pass 1 — Agent Update (`updateAgents`)

For every agent:

1. **Sense**: Sample the trail map at three points ahead of the agent:
   - **Left** sensor at angle `θ − π/8`, distance 3 pixels.
   - **Center** sensor at angle `θ`, distance 3 pixels.
   - **Right** sensor at angle `θ + π/8`, distance 3 pixels.

   Each sensor reads the trail value using **bilinear interpolation** for sub-pixel accuracy.

2. **Rotate**: Adjust heading based on sensed values:
   - If **center < left** and **center < right** → random steer (scaled by `agentRotationSpeed × dt`).
   - Else if **right > left** → steer right (`+agentRotationSpeed × dt`).
   - Else if **left > right** → steer left (`−agentRotationSpeed × dt`).

3. **Move**: Advance position by `agentSpeed × dt` in the heading direction.

4. **Boundary check**: If close to an edge (within 10 px), randomize heading to push the agent back inward.

5. **Deposit**: Add `1 × dt` to a temporary deposit map at the agent's (integer) position.

#### Pass 2 — Deposit Merge (`sumAndReset`)

For every pixel: add the temporary deposit map into the main trail map (clamped to [0, 1]), then clear the temporary map.

#### Pass 3 — Diffuse & Evaporate (`smooth`)

For every pixel (excluding the 1-px border):

1. **3×3 box blur**: Compute the average of the pixel and its 8 neighbors (equal weights, sum = 9).
2. **Diffusion**: Linearly interpolate between the original value and the blur result, controlled by `diffusionFactor × dt`.
3. **Evaporation**: Subtract `evaporationFactor × dt`, clamped to ≥ 0.

The source and destination maps are **double-buffered** (ping-pong swap each frame).

#### Pass 4 — Colorize (`floatMapToRgbaMap`)

Map each trail value (0–1) to an RGBA color via a **piecewise-linear color ramp**:

| Trail value | Color (R, G, B) |
|-------------|-----------------|
| 0.00        | (0, 0, 0)       |
| 0.01        | (50, 50, 50)    |
| 0.80        | (150, 150, 150) |
| 1.00        | (255, 255, 255) |

### 3. Hashing / Randomness

A simple integer hash function provides deterministic pseudo-random numbers per agent per frame:

```
hash(state) = state ^= 2747636419; state *= 2654435769; state ^= state >> 16;
              state *= 2654435769; state ^= state >> 16; state *= 2654435769;
```

The seed is derived from the current time combined with the agent index.

### 4. Adjustable Parameters

| Parameter             | Default        | Description                                      |
|-----------------------|----------------|--------------------------------------------------|
| `agentSpeed`          | 4.0            | Pixels per second each agent travels              |
| `agentRotationSpeed`  | π (≈ 3.14)    | Radians per second maximum steering               |
| `diffusionFactor`     | 2.0            | Blur blending strength (higher = more spread)     |
| `evaporationFactor`   | 0.2            | Trail decay per second (higher = faster fade)     |
| `dt`                  | 1/8            | Simulation time step per frame                    |
| `agentsCount`         | 1,000,000      | Number of simultaneous agents                     |
| `mapSize`             | 1920 × 1080    | Trail map resolution                              |

## Running

Open `index.html` in a WebGPU-capable browser (Chrome 113+, Edge 113+, or Firefox Nightly with `dom.webgpu.enabled`).

No build step or server required — just open the file.

## Project Structure

```
index.html      — Entry point, canvas, and UI shell
style.css       — Dashboard and canvas styling  (shared with other projects)
slime.js        — Simulation engine (WebGPU compute + render)
ui.js           — Dashboard controls
```

## Original Project

Ported from a C# / CudaFy (OpenCL) + MonoGame desktop application. The GPU kernels were translated to WGSL compute shaders; the Windows Forms parameter controller was replaced with an in-browser dashboard.
