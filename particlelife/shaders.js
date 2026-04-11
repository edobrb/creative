// shaders.js — WebGPU compute and render shaders for Particle Life.

// Compute shader: calculate forces between all particle pairs.
// Uniform layout:
//   params: { n: u32, speciesCount: u32, dt: f32, friction: f32, bx: f32, by: f32, mouseX: f32, mouseY: f32, mouseForce: f32 }
// Storage buffers:
//   positions:  array<vec2<f32>>   (read)
//   velocities: array<vec2<f32>>   (read/write)
//   species:    array<u32>         (read)
//   forces:     array of F structs packed as 7 floats per pair (K*K entries)

export const computeForcesWGSL = /* wgsl */ `

struct Params {
    n:           u32,
    speciesCount: u32,
    dt:          f32,
    friction:    f32,
    bx:          f32,
    by:          f32,
    mouseX:      f32,
    mouseY:      f32,
    mouseForce:  f32,
    _pad0:       f32,
    _pad1:       f32,
    _pad2:       f32,
};

struct ForceRule {
    dMin:  f32,
    dStar: f32,
    dMax:  f32,
    p:     f32,
    m0:    f32,
    m1:    f32,
    m2:    f32,
    _pad:  f32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read>       positions  : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities : array<vec2<f32>>;
@group(0) @binding(3) var<storage, read>       species    : array<u32>;
@group(0) @binding(4) var<storage, read>       rules      : array<ForceRule>;

fn wrapDelta(d: f32, bound: f32) -> f32 {
    var v = d;
    if (v >  bound) { v -= bound * 2.0; }
    if (v < -bound) { v += bound * 2.0; }
    return v;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }

    let pos_i = positions[i];
    let c_i   = species[i];
    var acc   = vec2<f32>(0.0, 0.0);

    for (var j = 0u; j < params.n; j++) {
        if (j == i) { continue; }

        var dx = wrapDelta(positions[j].x - pos_i.x, params.bx);
        var dy = wrapDelta(positions[j].y - pos_i.y, params.by);
        let d2 = dx * dx + dy * dy;
        let c_j = species[j];
        let rule = rules[c_i * params.speciesCount + c_j];

        if (d2 > rule.dMax * rule.dMax || d2 < 0.0001) { continue; }

        let dist = sqrt(d2);
        let dir  = vec2<f32>(dx, dy) / dist;

        var f = 0.0;
        if (dist < rule.dMin) {
            f = (pow(rule.dMin / dist, rule.p) - 1.0) * rule.m0;
        } else if (dist < rule.dStar) {
            f = (dist - rule.dMin) * rule.m1;
        } else {
            f = (dist - rule.dStar) * rule.m2;
        }

        acc += dir * f;
    }

    // Mouse force
    if (params.mouseForce != 0.0) {
        var mdx = wrapDelta(params.mouseX - pos_i.x, params.bx);
        var mdy = wrapDelta(params.mouseY - pos_i.y, params.by);
        let md2 = mdx * mdx + mdy * mdy;
        if (md2 > 1.0) {
            let mf = params.mouseForce / pow(md2, 0.2);
            let mdir = vec2<f32>(mdx, mdy) / sqrt(md2);
            acc += mdir * mf;
        }
    }

    // Drag + integrate velocity
    var vel = velocities[i];
    let speed = length(vel);
    if (speed > 0.0001) {
        acc -= normalize(vel) * params.friction * speed;
    }
    vel += acc * params.dt;
    velocities[i] = vel;
}
`;

// Compute shader: integrate positions.
export const integrateWGSL = /* wgsl */ `

struct Params {
    n:           u32,
    speciesCount: u32,
    dt:          f32,
    friction:    f32,
    bx:          f32,
    by:          f32,
    mouseX:      f32,
    mouseY:      f32,
    mouseForce:  f32,
    _pad0:       f32,
    _pad1:       f32,
    _pad2:       f32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read_write> positions  : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read>       velocities : array<vec2<f32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }

    var pos = positions[i] + velocities[i] * params.dt;

    // Wrap toroidally
    if (pos.x >  params.bx) { pos.x -= params.bx * 2.0; }
    if (pos.x < -params.bx) { pos.x += params.bx * 2.0; }
    if (pos.y >  params.by) { pos.y -= params.by * 2.0; }
    if (pos.y < -params.by) { pos.y += params.by * 2.0; }

    positions[i] = pos;
}
`;

// Render shaders: draw particles as instanced quads (circles).
export const renderVertexWGSL = /* wgsl */ `

struct Uniforms {
    viewportSize: vec2<f32>,
    halfWorld:    vec2<f32>,
    alpha:        f32,
    radius:       f32,
    _pad0:        f32,
    _pad1:        f32,
};

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) color     : vec4<f32>,
    @location(1) uv        : vec2<f32>,
};

const QUAD_POS = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
);

@group(0) @binding(0) var<uniform>       uni       : Uniforms;
@group(0) @binding(1) var<storage, read> positions : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> species   : array<u32>;
@group(0) @binding(3) var<storage, read> colors    : array<vec4<f32>>;

@vertex
fn main(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VSOut {
    var out : VSOut;
    let quadVert = QUAD_POS[vi];
    let worldPos = positions[ii];
    let ndc = worldPos / uni.halfWorld;
    // Offset by radius in pixel space, converted to NDC
    let pixelOffset = quadVert * uni.radius;
    let ndcOffset = pixelOffset * 2.0 / uni.viewportSize;
    out.pos = vec4<f32>(ndc.x + ndcOffset.x, -ndc.y + ndcOffset.y, 0.0, 1.0);
    let c = colors[species[ii]];
    out.color = vec4<f32>(c.rgb, c.a * uni.alpha);
    out.uv = quadVert;
    return out;
}
`;

export const renderFragmentWGSL = /* wgsl */ `

@fragment
fn main(@location(0) color : vec4<f32>, @location(1) uv : vec2<f32>) -> @location(0) vec4<f32> {
    let d = dot(uv, uv);
    if (d > 1.0) { discard; }
    return color;
}
`;
