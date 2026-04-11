// shaders.js — WGSL compute & render shaders for slime mold simulation

// ─── Compute: Initialize Agents ──────────────────────────────
export const initAgentsWGSL = /* wgsl */`

struct Params {
    sizeX          : u32,
    sizeY          : u32,
    agentCount     : u32,
    seed           : u32,
    dispatchStride : u32,  // wgX * 256
    _pad1          : u32,
    _pad2          : u32,
    _pad3          : u32,
};

@group(0) @binding(0) var<storage, read_write> agentPosX : array<f32>;
@group(0) @binding(1) var<storage, read_write> agentPosY : array<f32>;
@group(0) @binding(2) var<storage, read_write> agentRot  : array<f32>;
@group(0) @binding(3) var<uniform>             params    : Params;

fn hash(s: u32) -> u32 {
    var state = s;
    state ^= 2747636419u;
    state *= 2654435769u;
    state ^= state >> 16u;
    state *= 2654435769u;
    state ^= state >> 16u;
    state *= 2654435769u;
    return state;
}

fn randomFloat(s: u32) -> f32 {
    return f32(hash(s)) / 4294967295.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
    let i = gid.x + gid.y * params.dispatchStride;
    if (i >= params.agentCount) { return; }

    let cx = f32(params.sizeX) * 0.5;
    let cy = f32(params.sizeY) * 0.5;

    // Uniform distribution within circle: r = R * sqrt(rand), theta = rand * 2π
    let r     = 10.0 * sqrt(randomFloat(hash(params.seed + i * 2u)));
    let theta = randomFloat(hash(params.seed + i * 2u + 1u)) * 6.28318530;

    let px = cx + r * cos(theta);
    let py = cy + r * sin(theta);

    agentPosX[i] = px;
    agentPosY[i] = py;
    agentRot[i]  = atan2(cy - py, cx - px);
}
`;

// ─── Compute: Update Agents ──────────────────────────────────
export const updateAgentsWGSL = /* wgsl */`

struct Params {
    sizeX              : u32,
    sizeY              : u32,
    agentCount         : u32,
    seed               : u32,
    dt                 : f32,
    agentSpeed         : f32,
    agentRotationSpeed : f32,
    dispatchStride     : u32,  // wgX * 256
};

@group(0) @binding(0) var<storage, read>       trailMap   : array<f32>;
@group(0) @binding(1) var<storage, read_write>  depositMap : array<f32>;
@group(0) @binding(2) var<storage, read_write>  agentPosX  : array<f32>;
@group(0) @binding(3) var<storage, read_write>  agentPosY  : array<f32>;
@group(0) @binding(4) var<storage, read_write>  agentRot   : array<f32>;
@group(0) @binding(5) var<uniform>              params     : Params;

fn hash(s: u32) -> u32 {
    var state = s;
    state ^= 2747636419u;
    state *= 2654435769u;
    state ^= state >> 16u;
    state *= 2654435769u;
    state ^= state >> 16u;
    state *= 2654435769u;
    return state;
}

fn randomFloat(s: u32) -> f32 {
    return f32(hash(s)) / 4294967295.0;
}

fn sampleBilinear(x: f32, y: f32, sizeX: u32) -> f32 {
    let xi = u32(floor(x));
    let yi = u32(floor(y));
    let fx = x - floor(x);
    let fy = y - floor(y);
    let wa = (1.0 - fx) * (1.0 - fy);
    let wb = fx * (1.0 - fy);
    let wc = (1.0 - fx) * fy;
    let wd = fx * fy;
    let a = trailMap[(xi + 0u) + (yi + 0u) * sizeX];
    let b = trailMap[(xi + 1u) + (yi + 0u) * sizeX];
    let c = trailMap[(xi + 0u) + (yi + 1u) * sizeX];
    let d = trailMap[(xi + 1u) + (yi + 1u) * sizeX];
    return a * wa + b * wb + c * wc + d * wd;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
    let i = gid.x + gid.y * params.dispatchStride;
    if (i >= params.agentCount) { return; }

    let sizeX = params.sizeX;
    let sizeY = params.sizeY;
    let dt    = params.dt;
    let speed = params.agentSpeed;
    let rotSpeed = params.agentRotationSpeed;
    let seed  = params.seed;

    var ax = agentPosX[i];
    var ay = agentPosY[i];
    var ar = agentRot[i];

    let pi8 = 3.14159265 / 8.0;

    // Sense
    let sensorDist = 3.0;
    let plx = ax + sensorDist * cos(ar - pi8);
    let ply = ay + sensorDist * sin(ar - pi8);
    let pcx = ax + sensorDist * cos(ar);
    let pcy = ay + sensorDist * sin(ar);
    let prx = ax + sensorDist * cos(ar + pi8);
    let pry = ay + sensorDist * sin(ar + pi8);

    // Clamp sensor positions to safe range
    let maxX = f32(sizeX - 2u);
    let maxY = f32(sizeY - 2u);
    let left   = sampleBilinear(clamp(plx, 1.0, maxX), clamp(ply, 1.0, maxY), sizeX);
    let center = sampleBilinear(clamp(pcx, 1.0, maxX), clamp(pcy, 1.0, maxY), sizeX);
    let right  = sampleBilinear(clamp(prx, 1.0, maxX), clamp(pry, 1.0, maxY), sizeX);

    // Rotate
    if (center < left && center < right) {
        ar += (randomFloat(seed * (i + 2u)) - 0.5) * 2.0 * rotSpeed * dt;
    } else if (right > left) {
        ar += rotSpeed * dt;
    } else if (left > right) {
        ar -= rotSpeed * dt;
    }

    // Move
    ax += speed * dt * cos(ar);
    ay += speed * dt * sin(ar);

    // Boundary bounce
    if (ax <= 10.0) { ar = randomFloat(seed * (i + 1u)) * 3.14159265 - 3.14159265 / 2.0; }
    if (ay <= 10.0) { ar = randomFloat(seed * (i + 1u)) * 3.14159265; }
    if (ax > f32(sizeX) - 10.0) { ar = randomFloat(seed * (i + 1u)) * 3.14159265 + 3.14159265 / 2.0; }
    if (ay > f32(sizeY) - 10.0) { ar = randomFloat(seed * (i + 1u)) * 3.14159265 + 3.14159265; }

    // Clamp position to valid range
    ax = clamp(ax, 1.0, f32(sizeX) - 2.0);
    ay = clamp(ay, 1.0, f32(sizeY) - 2.0);

    agentPosX[i] = ax;
    agentPosY[i] = ay;
    agentRot[i] = ar;

    // Deposit trail (atomic would be ideal, but f32 atomics aren't available — use relaxed write)
    let ix = u32(ax + 0.5);
    let iy = u32(ay + 0.5);
    let mapIdx = ix + iy * sizeX;
    depositMap[mapIdx] += 1.0 * dt;
}
`;

// ─── Compute: Sum deposit into trail and reset deposit ───────
export const sumAndResetWGSL = /* wgsl */`

struct Params {
    totalPixels : u32,
};

@group(0) @binding(0) var<storage, read_write> depositMap : array<f32>;
@group(0) @binding(1) var<storage, read_write> trailMap   : array<f32>;
@group(0) @binding(2) var<uniform>             params     : Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
    let i = gid.x;
    if (i >= params.totalPixels) { return; }
    trailMap[i] = min(1.0, trailMap[i] + depositMap[i]);
    depositMap[i] = 0.0;
}
`;

// ─── Compute: Diffuse + Evaporate (3×3 blur) ────────────────
export const smoothWGSL = /* wgsl */`

struct Params {
    sizeX            : u32,
    sizeY            : u32,
    diffusionFactor  : f32,
    evaporationFactor: f32,
    dt               : f32,
    _pad1            : f32,
    _pad2            : f32,
    _pad3            : f32,
};

@group(0) @binding(0) var<storage, read>       mapSource : array<f32>;
@group(0) @binding(1) var<storage, read_write>  mapDest   : array<f32>;
@group(0) @binding(2) var<uniform>              params    : Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid : vec3u) {
    let x = gid.x;
    let y = gid.y;
    let sizeX = params.sizeX;
    let sizeY = params.sizeY;

    if (x == 0u || y == 0u || x >= sizeX - 1u || y >= sizeY - 1u) { return; }

    let i = x + y * sizeX;

    let p0 = mapSource[(x - 1u) + (y - 1u) * sizeX];
    let p1 = mapSource[(x + 0u) + (y - 1u) * sizeX];
    let p2 = mapSource[(x + 1u) + (y - 1u) * sizeX];
    let p3 = mapSource[i - 1u];
    let p4 = mapSource[i];
    let p5 = mapSource[i + 1u];
    let p6 = mapSource[(x - 1u) + (y + 1u) * sizeX];
    let p7 = mapSource[(x + 0u) + (y + 1u) * sizeX];
    let p8 = mapSource[(x + 1u) + (y + 1u) * sizeX];

    let blurResult = (p0 + p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8) / 9.0;
    let diffused = mix(p4, blurResult, params.diffusionFactor * params.dt);
    let final_val = max(0.0, diffused - params.evaporationFactor * params.dt);
    mapDest[i] = final_val;
}
`;

// ─── Compute: Float trail map → RGBA u32 via color ramp ─────
export const colorizeWGSL = /* wgsl */`

struct Params {
    sizeX      : u32,
    sizeY      : u32,
    numStops   : u32,
    _pad       : u32,
};

struct ColorStop {
    position : f32,
    r        : f32,
    g        : f32,
    b        : f32,
};

@group(0) @binding(0) var<storage, read>       trailMap : array<f32>;
@group(0) @binding(1) var<storage, read_write>  rgbaMap  : array<u32>;
@group(0) @binding(2) var<uniform>              params   : Params;
@group(0) @binding(3) var<storage, read>        stops    : array<ColorStop>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
    let i = gid.x;
    let total = params.sizeX * params.sizeY;
    if (i >= total) { return; }

    let v = clamp(trailMap[i], 0.0, 1.0);

    // Find the color stop pair
    var upper = params.numStops - 1u;
    for (var k = 1u; k < params.numStops; k++) {
        if (stops[k].position >= v) {
            upper = k;
            break;
        }
    }
    let lower = upper - 1u;

    let range = stops[upper].position - stops[lower].position;
    var t = 0.0;
    if (range > 0.0) {
        t = (v - stops[lower].position) / range;
    }

    let r = u32(stops[lower].r * (1.0 - t) + stops[upper].r * t + 0.5);
    let g = u32(stops[lower].g * (1.0 - t) + stops[upper].g * t + 0.5);
    let b = u32(stops[lower].b * (1.0 - t) + stops[upper].b * t + 0.5);

    // RGBA8 packed as u32: ABGR for little-endian / canvas ImageData
    rgbaMap[i] = (255u << 24u) | (b << 16u) | (g << 8u) | r;
}
`;

// ─── Fullscreen quad render shaders ──────────────────────────
export const renderVertexWGSL = /* wgsl */`

struct VSOut {
    @builtin(position) position : vec4f,
    @location(0) uv : vec2f,
};

@vertex
fn main(@builtin(vertex_index) vi : u32) -> VSOut {
    // Fullscreen triangle (3 verts cover the screen)
    var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0),
    );
    var uv = array<vec2f, 3>(
        vec2f(0.0, 1.0),
        vec2f(2.0, 1.0),
        vec2f(0.0, -1.0),
    );
    var out : VSOut;
    out.position = vec4f(pos[vi], 0.0, 1.0);
    out.uv = uv[vi];
    return out;
}
`;

export const renderFragmentWGSL = /* wgsl */`

@group(0) @binding(0) var texSampler : sampler;
@group(0) @binding(1) var tex : texture_2d<f32>;

@fragment
fn main(@location(0) uv : vec2f) -> @location(0) vec4f {
    return textureSample(tex, texSampler, uv);
}
`;
