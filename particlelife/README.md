# Particle Life — WebGPU

An interactive particle-life simulation running entirely in the browser, accelerated by WebGPU compute shaders.

## Mechanics

**Particle Life** is an artificial-life system where thousands of particles belonging to different *species* (clusters) interact through simple distance-based force rules. Despite the simplicity of each rule, the emergent behaviour can produce surprisingly complex, life-like structures — cells, symbiosis, hunting, and flocking.

### Particles & Species

- **N** particles are distributed across **K** species (clusters).
- Each particle has a 2D position and velocity.
- The simulation space wraps toroidally (particles leaving one edge reappear on the opposite side).

### Force Model

Every ordered pair of species `(A, B)` defines a piecewise force function characterised by seven parameters:

| Parameter | Meaning |
|-----------|---------|
| `dMin`    | Inner repulsion radius |
| `dStar`   | Attraction peak radius |
| `dMax`    | Maximum interaction radius (cutoff) |
| `p`       | Repulsion power (steepness of inner repulsion) |
| `m0`      | Repulsion magnitude (`d < dMin`) |
| `m1`      | Mid-range force magnitude (`dMin ≤ d < dStar`) |
| `m2`      | Outer-range force magnitude (`dStar ≤ d < dMax`) |

For a particle of species A influenced by a particle of species B at distance `d`:

```
if d > dMax          → f = 0                          (no interaction)
if d < dMin          → f = ((1 / (d/dMin)^p) - 1) * m0   (strong repulsion)
if dMin ≤ d < dStar  → f = (d - dMin) * m1             (attraction/repulsion zone)
if dStar ≤ d < dMax  → f = (d - dStar) * m2            (outer attraction/repulsion zone)
```

The force is applied along the direction vector between the two particles.

### Integration & Drag

Each frame:
1. **Compute forces** — for every particle, sum forces from all other particles.
2. **Apply drag** — velocity is damped proportionally to its magnitude: `drag = -friction * |v| * v̂`.
3. **Integrate** — standard Euler integration: `v += a * dt`, `x += v * dt`.
4. **Wrap** — positions wrap toroidally.

### Mouse Interaction

- **Left-click** attracts nearby particles toward the cursor.
- **Right-click** repels particles away from the cursor.

## Controls

The side panel (built with the shared dashboard components) lets you tune:

- **Particle count** and **species count**
- **Friction** (drag coefficient)
- **Time step** (`dt`)
- **Mouse force strength**
- **Randomize** / **Reset** the force matrix
- **Per-species-pair force parameters** (dMin, dStar, dMax, m0, m1, m2, p)

## Tech Stack

- **HTML / CSS / JS** — standard web stack, ES modules
- **WebGPU** — compute shaders for force computation and integration, render pipeline for drawing
- **Shared UI** — reuses `shared/dashboard.js` and `shared/dashboard.css`
