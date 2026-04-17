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

## Entropy Analysis

The simulation continuously measures the **Shannon entropy** of the particle system, providing a quantitative view of how ordered or disordered the current state is.

### How it works

The world is divided into a uniform grid of cells. Each cell tracks how many particles of each species it contains, forming a joint probability distribution over *(cell, species)* pairs. The Shannon entropy is then:

$$H = -\sum_i p_i \log_2 p_i$$

where each $p_i$ is the fraction of particles in a particular (cell, species) bin.

- **High entropy** means particles are spread evenly across the space and across species — a disordered, gas-like state.
- **Low entropy** means particles are clustered in specific regions or dominated by few species — an ordered, crystalline or segregated state.

The entropy is sampled periodically (every few simulation steps) and displayed as a rolling time-series chart, along with the current value, the running average, and the standard deviation.

### Why it matters

Entropy is a single number that summarises the global spatial structure of the system. Watching it over time reveals patterns invisible to the naked eye: periodic oscillations indicate self-organising cycles, a steadily rising entropy suggests the system is dissolving structure, and a low flat entropy indicates a frozen, ordered configuration.

## Criticality Optimizer

The criticality optimizer is an automated system that nudges the force rules toward the **edge of chaos** — the boundary between rigid order and total randomness where complex, life-like behaviour tends to emerge.

### The idea

Many complex systems (cellular automata, neural networks, ecosystems) exhibit the most interesting dynamics at a **critical point** — not too ordered (static crystals, frozen clusters) and not too chaotic (uniform gas, random noise). At criticality, correlations span the entire system, fluctuations are maximal, and small perturbations can cascade into large-scale reorganisations.

The optimizer uses the **coefficient of variation** (CV) of the entropy time series as a proxy for criticality:

$$CV = \frac{\sigma_H}{\mu_H}$$

where $\sigma_H$ is the standard deviation and $\mu_H$ is the mean of recent entropy values. A high CV means entropy is fluctuating strongly relative to its average — the hallmark of a critical regime. A low CV means the system is either stuck in a fixed state (low entropy, low variance) or uniformly mixed (high entropy, low variance).

### How it works

The optimizer performs **stochastic hill-climbing** on the CV:

1. **Wait for warmup** — collect enough entropy samples to get reliable statistics.
2. **Perturb** — pick a random species-pair interaction and apply a small random change to one of its force magnitudes (m0, m1, or m2).
3. **Evaluate** — after the perturbation has had time to affect the system, compare the new CV to the previous one.
4. **Keep or revert** — if the CV increased (more critical), keep the change. If it decreased, revert it.
5. **Repeat** — continue indefinitely, gradually sculpting the force matrix toward maximal criticality.

### Parameters

- **Strength** — the magnitude of each perturbation. Larger values explore faster but can overshoot; smaller values refine more gently.
- **Interval** — how many simulation steps between perturbations. Longer intervals give the system more time to respond, producing more reliable CV estimates.

The result is a force matrix that self-tunes toward configurations where the particle system hovers at the boundary of order and chaos — often the most visually striking and behaviourally rich regime.

## Tech Stack

- **HTML / CSS / JS** — standard web stack, ES modules
- **WebGPU** — compute shaders for force computation and integration, render pipeline for drawing
- **Shared UI** — reuses `shared/dashboard.js` and `shared/dashboard.css`
