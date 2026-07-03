// SPDX-License-Identifier: AGPL-3.0-only
// Natural-layout core force simulation, ported from d3-force-3d for WASM.
//
// Faithful port of the precalc core sim used in force3d.worker.ts:
//   forces (insertion order): link → manyBody(charge) → center → [collide]
//   integration: alpha += (0 - alpha)*alphaDecay; per force(alpha); v *= velocityDecay; x += v
//   phase 1: tick collide-free until alpha<min OR mean|v|<0.5 for 3 ticks OR max_ticks
//   phase 2: add collide, run exactly `collide_ticks` ticks
//
// Marshalling is plain wasm (no wasm-bindgen): JS allocs buffers via `alloc`,
// writes f32/u32 arrays into linear memory, calls `run_core`, reads positions back.

#![allow(clippy::missing_safety_doc)]

use std::alloc::{alloc as rust_alloc, dealloc as rust_dealloc, Layout};

// ── linear-memory allocator exports ─────────────────────────────────────────
#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    unsafe {
        let layout = Layout::from_size_align_unchecked(size, 8);
        rust_alloc(layout)
    }
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }
    let layout = Layout::from_size_align_unchecked(size, 8);
    rust_dealloc(ptr, layout);
}

// ── deterministic jiggle (d3 LCG: s = (1664525 s + 1013904223) mod 2^32) ─────
struct Lcg {
    s: u32,
}
impl Lcg {
    fn new() -> Self {
        Lcg { s: 1 }
    }
    #[inline]
    fn next(&mut self) -> f32 {
        self.s = self.s.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.s as f32) / 4294967296.0
    }
    #[inline]
    fn jiggle(&mut self) -> f32 {
        (self.next() - 0.5) * 1e-6
    }
}

// ── Barnes-Hut octree (flat arrays) ──────────────────────────────────────────
// Internal cells store 8 child indices; leaves store a contiguous range into a
// reordered index buffer. accumulate() mirrors d3-force-3d/manyBody:
//   internal.value = sqrt(4/8) * sum(child.value); com weighted by |value|
const NO_CHILD: u32 = u32::MAX;
const DIM_SCALE: f32 = 0.70710678; // sqrt(4/8) for the octree's 8-way split
const MAX_DEPTH: u32 = 40;

struct Octree {
    // per cell
    children: Vec<[u32; 8]>, // NO_CHILD if absent; internal nodes only
    leaf_start: Vec<u32>,    // for leaves: range into `order`; u32::MAX for internal
    leaf_len: Vec<u32>,
    cx: Vec<f32>,
    cy: Vec<f32>,
    cz: Vec<f32>,
    half: Vec<f32>,
    value: Vec<f32>,
    comx: Vec<f32>,
    comy: Vec<f32>,
    comz: Vec<f32>,
    order: Vec<u32>, // point indices reordered into leaf-contiguous ranges
}

impl Octree {
    fn with_capacity(n: usize) -> Self {
        let cap = (2 * n).max(8);
        Octree {
            children: Vec::with_capacity(cap),
            leaf_start: Vec::with_capacity(cap),
            leaf_len: Vec::with_capacity(cap),
            cx: Vec::with_capacity(cap),
            cy: Vec::with_capacity(cap),
            cz: Vec::with_capacity(cap),
            half: Vec::with_capacity(cap),
            value: Vec::with_capacity(cap),
            comx: Vec::with_capacity(cap),
            comy: Vec::with_capacity(cap),
            comz: Vec::with_capacity(cap),
            order: Vec::with_capacity(n),
        }
    }

    fn clear(&mut self) {
        self.children.clear();
        self.leaf_start.clear();
        self.leaf_len.clear();
        self.cx.clear();
        self.cy.clear();
        self.cz.clear();
        self.half.clear();
        self.value.clear();
        self.comx.clear();
        self.comy.clear();
        self.comz.clear();
        self.order.clear();
    }

    #[inline]
    fn push_cell(&mut self, cx: f32, cy: f32, cz: f32, half: f32) -> u32 {
        let idx = self.children.len() as u32;
        self.children.push([NO_CHILD; 8]);
        self.leaf_start.push(u32::MAX);
        self.leaf_len.push(0);
        self.cx.push(cx);
        self.cy.push(cy);
        self.cz.push(cz);
        self.half.push(half);
        self.value.push(0.0);
        self.comx.push(0.0);
        self.comy.push(0.0);
        self.comz.push(0.0);
        idx
    }

    // Build over the given point positions (pos: 3n). `scratch` is reused buffer.
    fn build(&mut self, pos: &[f32], pts: &mut Vec<u32>, scratch: &mut Vec<u32>) {
        self.clear();
        let n = pts.len();
        if n == 0 {
            return;
        }
        // root cube bounds
        let (mut minx, mut miny, mut minz) = (f32::INFINITY, f32::INFINITY, f32::INFINITY);
        let (mut maxx, mut maxy, mut maxz) = (f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
        for &p in pts.iter() {
            let i = p as usize * 3;
            let (x, y, z) = (pos[i], pos[i + 1], pos[i + 2]);
            if x < minx { minx = x }
            if y < miny { miny = y }
            if z < minz { minz = z }
            if x > maxx { maxx = x }
            if y > maxy { maxy = y }
            if z > maxz { maxz = z }
        }
        let cx = (minx + maxx) * 0.5;
        let cy = (miny + maxy) * 0.5;
        let cz = (minz + maxz) * 0.5;
        let mut half = (maxx - minx).max(maxy - miny).max(maxz - minz) * 0.5;
        if half <= 0.0 {
            half = 1.0;
        }
        half *= 1.0001; // pad so all points are strictly inside
        self.order.resize(n, 0);
        self.order.copy_from_slice(pts);
        if scratch.len() < n {
            scratch.resize(n, 0);
        }
        self.build_rec(pos, 0, n, cx, cy, cz, half, 0, scratch);
    }

    // Builds a cell covering order[start..end]; returns its cell index.
    #[allow(clippy::too_many_arguments)]
    fn build_rec(
        &mut self,
        pos: &[f32],
        start: usize,
        end: usize,
        cx: f32,
        cy: f32,
        cz: f32,
        half: f32,
        depth: u32,
        scratch: &mut Vec<u32>,
    ) -> u32 {
        let count = end - start;
        let cell = self.push_cell(cx, cy, cz, half);
        if count <= 1 || depth >= MAX_DEPTH {
            self.leaf_start[cell as usize] = start as u32;
            self.leaf_len[cell as usize] = count as u32;
            return cell;
        }
        // 8-way counting-sort partition of order[start..end] into octants
        let mut counts = [0usize; 8];
        for k in start..end {
            let p = self.order[k] as usize * 3;
            let oct = (((pos[p] >= cx) as usize) << 2)
                | (((pos[p + 1] >= cy) as usize) << 1)
                | ((pos[p + 2] >= cz) as usize);
            counts[oct] += 1;
        }
        let mut offsets = [0usize; 9];
        for o in 0..8 {
            offsets[o + 1] = offsets[o] + counts[o];
        }
        let bucket_bounds = offsets; // copy: bucket o occupies [offsets[o], offsets[o+1])
        let mut cursor = offsets;
        for k in start..end {
            let pid = self.order[k];
            let p = pid as usize * 3;
            let oct = (((pos[p] >= cx) as usize) << 2)
                | (((pos[p + 1] >= cy) as usize) << 1)
                | ((pos[p + 2] >= cz) as usize);
            scratch[cursor[oct]] = pid;
            cursor[oct] += 1;
        }
        // copy sorted buckets back into order[start..end]
        self.order[start..end].copy_from_slice(&scratch[0..count]);
        let qh = half * 0.5;
        for o in 0..8 {
            let b0 = start + bucket_bounds[o];
            let b1 = start + bucket_bounds[o + 1];
            if b1 == b0 {
                continue;
            }
            let ncx = if o & 4 != 0 { cx + qh } else { cx - qh };
            let ncy = if o & 2 != 0 { cy + qh } else { cy - qh };
            let ncz = if o & 1 != 0 { cz + qh } else { cz - qh };
            let child = self.build_rec(pos, b0, b1, ncx, ncy, ncz, qh, depth + 1, scratch);
            self.children[cell as usize][o] = child;
        }
        cell
    }

    // Post-order accumulate of charge (value) + center of mass, mirroring d3.
    fn accumulate_charge(&mut self, pos: &[f32], strengths: &[f32]) {
        // children are always at a higher index than their parent (push order),
        // so a reverse pass over cells is a valid post-order.
        for cell in (0..self.children.len()).rev() {
            let ls = self.leaf_start[cell];
            if ls != u32::MAX {
                // leaf: value = sum strengths; com = |value|-weighted avg position
                let s = ls as usize;
                let e = s + self.leaf_len[cell] as usize;
                let mut val = 0.0f32;
                let (mut wx, mut wy, mut wz, mut w) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
                for k in s..e {
                    let pid = self.order[k] as usize;
                    let st = strengths[pid];
                    val += st;
                    let c = st.abs();
                    let p = pid * 3;
                    wx += c * pos[p];
                    wy += c * pos[p + 1];
                    wz += c * pos[p + 2];
                    w += c;
                }
                self.value[cell] = val;
                if w > 0.0 {
                    self.comx[cell] = wx / w;
                    self.comy[cell] = wy / w;
                    self.comz[cell] = wz / w;
                } else {
                    // zero-charge leaf: fall back to geometric position of first pt
                    let p = self.order[s] as usize * 3;
                    self.comx[cell] = pos[p];
                    self.comy[cell] = pos[p + 1];
                    self.comz[cell] = pos[p + 2];
                }
            } else {
                let mut strength = 0.0f32;
                let (mut wx, mut wy, mut wz, mut w) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
                let kids = self.children[cell];
                for &c in kids.iter() {
                    if c == NO_CHILD {
                        continue;
                    }
                    let v = self.value[c as usize];
                    strength += v;
                    let a = v.abs();
                    w += a;
                    wx += a * self.comx[c as usize];
                    wy += a * self.comy[c as usize];
                    wz += a * self.comz[c as usize];
                }
                strength *= DIM_SCALE;
                self.value[cell] = strength;
                if w > 0.0 {
                    self.comx[cell] = wx / w;
                    self.comy[cell] = wy / w;
                    self.comz[cell] = wz / w;
                }
            }
        }
    }
}

// ── force application ─────────────────────────────────────────────────────────
#[allow(clippy::too_many_arguments)]
fn apply_manybody(
    tree: &Octree,
    pos: &[f32],
    vel: &mut [f32],
    strengths: &[f32],
    alpha: f32,
    theta2: f32,
    dist_min2: f32,
    lcg: &mut Lcg,
    stack: &mut Vec<u32>,
    n: usize,
) {
    if tree.children.is_empty() {
        return;
    }
    for i in 0..n {
        let p = i * 3;
        let (xi, yi, zi) = (pos[p], pos[p + 1], pos[p + 2]);
        let (mut ax, mut ay, mut az) = (0.0f32, 0.0f32, 0.0f32);
        stack.clear();
        stack.push(0);
        while let Some(cell) = stack.pop() {
            let c = cell as usize;
            let val = tree.value[c];
            if val == 0.0 {
                continue;
            }
            let is_leaf = tree.leaf_start[c] != u32::MAX;
            let w = tree.half[c] * 2.0; // cell width
            let mut dx = tree.comx[c] - xi;
            let mut dy = tree.comy[c] - yi;
            let mut dz = tree.comz[c] - zi;
            let mut l = dx * dx + dy * dy + dz * dz;
            // Barnes-Hut approximation (distanceMax = Inf so the inner gate is always true)
            if !is_leaf && (w * w / theta2) < l {
                if dx == 0.0 { dx = lcg.jiggle(); l += dx * dx; }
                if dy == 0.0 { dy = lcg.jiggle(); l += dy * dy; }
                if dz == 0.0 { dz = lcg.jiggle(); l += dz * dz; }
                if l < dist_min2 { l = (dist_min2 * l).sqrt(); }
                let f = val * alpha / l;
                ax += dx * f;
                ay += dy * f;
                az += dz * f;
                continue;
            }
            if is_leaf {
                // direct per-point
                let s = tree.leaf_start[c] as usize;
                let e = s + tree.leaf_len[c] as usize;
                for k in s..e {
                    let j = tree.order[k] as usize;
                    if j == i {
                        continue;
                    }
                    let jp = j * 3;
                    let mut ex = pos[jp] - xi;
                    let mut ey = pos[jp + 1] - yi;
                    let mut ez = pos[jp + 2] - zi;
                    let mut ll = ex * ex + ey * ey + ez * ez;
                    if ex == 0.0 { ex = lcg.jiggle(); ll += ex * ex; }
                    if ey == 0.0 { ey = lcg.jiggle(); ll += ey * ey; }
                    if ez == 0.0 { ez = lcg.jiggle(); ll += ez * ez; }
                    if ll < dist_min2 { ll = (dist_min2 * ll).sqrt(); }
                    let f = strengths[j] * alpha / ll;
                    ax += ex * f;
                    ay += ey * f;
                    az += ez * f;
                }
            } else {
                let kids = tree.children[c];
                for &ch in kids.iter() {
                    if ch != NO_CHILD {
                        stack.push(ch);
                    }
                }
            }
        }
        vel[p] += ax;
        vel[p + 1] += ay;
        vel[p + 2] += az;
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_link(
    pos: &[f32],
    vel: &mut [f32],
    links: &[u32],
    bias: &[f32],
    distance: f32,
    strength: f32,
    alpha: f32,
    lcg: &mut Lcg,
) {
    let m = links.len() / 2;
    for i in 0..m {
        let s = links[i * 2] as usize;
        let t = links[i * 2 + 1] as usize;
        let sp = s * 3;
        let tp = t * 3;
        let mut x = pos[tp] + vel[tp] - pos[sp] - vel[sp];
        let mut y = pos[tp + 1] + vel[tp + 1] - pos[sp + 1] - vel[sp + 1];
        let mut z = pos[tp + 2] + vel[tp + 2] - pos[sp + 2] - vel[sp + 2];
        if x == 0.0 { x = lcg.jiggle(); }
        if y == 0.0 { y = lcg.jiggle(); }
        if z == 0.0 { z = lcg.jiggle(); }
        let l = (x * x + y * y + z * z).sqrt();
        let f = (l - distance) / l * alpha * strength;
        x *= f;
        y *= f;
        z *= f;
        let b = bias[i];
        vel[tp] -= x * b;
        vel[tp + 1] -= y * b;
        vel[tp + 2] -= z * b;
        let b1 = 1.0 - b;
        vel[sp] += x * b1;
        vel[sp + 1] += y * b1;
        vel[sp + 2] += z * b1;
    }
}

fn apply_center(pos: &mut [f32], n: usize, strength: f32) {
    if n == 0 {
        return;
    }
    let (mut sx, mut sy, mut sz) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..n {
        let p = i * 3;
        sx += pos[p];
        sy += pos[p + 1];
        sz += pos[p + 2];
    }
    let inv = 1.0 / n as f32;
    sx = sx * inv * strength;
    sy = sy * inv * strength;
    sz = sz * inv * strength;
    for i in 0..n {
        let p = i * 3;
        pos[p] -= sx;
        pos[p + 1] -= sy;
        pos[p + 2] -= sz;
    }
}

// Collide on (x+vx); equal radii so the rj²/(ri²+rj²) factor is 0.5.
#[allow(clippy::too_many_arguments)]
fn apply_collide(
    tree: &mut Octree,
    pos: &[f32],
    vel: &mut [f32],
    radius: f32,
    n: usize,
    cpos: &mut Vec<f32>, // scratch: x+vx positions
    pts: &mut Vec<u32>,
    scratch: &mut Vec<u32>,
    stack: &mut Vec<u32>,
    lcg: &mut Lcg,
) {
    if n == 0 {
        return;
    }
    cpos.resize(n * 3, 0.0);
    for i in 0..n * 3 {
        cpos[i] = pos[i] + vel[i];
    }
    if pts.len() != n {
        pts.resize(n, 0);
        for i in 0..n {
            pts[i] = i as u32;
        }
    }
    tree.build(cpos, pts, scratch);
    let r2 = (radius + radius) * (radius + radius);
    let two_r = radius + radius;
    for i in 0..n {
        let p = i * 3;
        let xi = cpos[p];
        let yi = cpos[p + 1];
        let zi = cpos[p + 2];
        stack.clear();
        stack.push(0);
        while let Some(cell) = stack.pop() {
            let c = cell as usize;
            let is_leaf = tree.leaf_start[c] != u32::MAX;
            // prune: skip cell whose padded box can't intersect i's collision sphere
            let hx = tree.half[c] + two_r;
            if (tree.cx[c] - xi).abs() > hx
                || (tree.cy[c] - yi).abs() > hx
                || (tree.cz[c] - zi).abs() > hx
            {
                continue;
            }
            if is_leaf {
                let s = tree.leaf_start[c] as usize;
                let e = s + tree.leaf_len[c] as usize;
                for k in s..e {
                    let j = tree.order[k] as usize;
                    if j <= i {
                        continue; // each pair once (data.index > node.index)
                    }
                    let jp = j * 3;
                    let mut dx = xi - cpos[jp];
                    let mut dy = yi - cpos[jp + 1];
                    let mut dz = zi - cpos[jp + 2];
                    let mut l = dx * dx + dy * dy + dz * dz;
                    if l < r2 {
                        if dx == 0.0 { dx = lcg.jiggle(); l += dx * dx; }
                        if dy == 0.0 { dy = lcg.jiggle(); l += dy * dy; }
                        if dz == 0.0 { dz = lcg.jiggle(); l += dz * dz; }
                        let ld = l.sqrt();
                        let f = (two_r - ld) / ld; // strength 1
                        dx *= f;
                        dy *= f;
                        dz *= f;
                        // equal radii → split 0.5/0.5
                        vel[p] += dx * 0.5;
                        vel[p + 1] += dy * 0.5;
                        vel[p + 2] += dz * 0.5;
                        vel[jp] -= dx * 0.5;
                        vel[jp + 1] -= dy * 0.5;
                        vel[jp + 2] -= dz * 0.5;
                    }
                }
            } else {
                let kids = tree.children[c];
                for &ch in kids.iter() {
                    if ch != NO_CHILD {
                        stack.push(ch);
                    }
                }
            }
        }
    }
}

// Per-cell max collide radius (post-order over the built tree), mirroring d3-force's
// collide `prepare` pass: each subtree knows the largest radius inside it, so the
// AABB prune from node i can use reach = ri + cell_max_r instead of ri + GLOBAL max.
// With ~99% regular nodes (r=12) and ultra radii up to 240, the global-max prune made
// every node search a ~250-unit box; per-cell reach cuts the traversal massively.
fn compute_cell_max_r(tree: &Octree, radii: &[f32], out: &mut Vec<f32>) {
    let ncells = tree.children.len();
    out.clear();
    out.resize(ncells, 0.0);
    // children are always at a higher index than their parent (push order),
    // so a reverse pass is a valid post-order (same trick as accumulate_charge).
    for cell in (0..ncells).rev() {
        let ls = tree.leaf_start[cell];
        let mut m = 0.0f32;
        if ls != u32::MAX {
            let s = ls as usize;
            let e = s + tree.leaf_len[cell] as usize;
            for k in s..e {
                let r = radii[tree.order[k] as usize];
                if r > m {
                    m = r;
                }
            }
        } else {
            for &c in tree.children[cell].iter() {
                if c == NO_CHILD {
                    continue;
                }
                let v = out[c as usize];
                if v > m {
                    m = v;
                }
            }
        }
        out[cell] = m;
    }
}

// Per-node-radius variant of apply_collide: each node i carries its own radius radii[i]
// (supernodes/ultranodes get larger clearance). Two nodes collide when their gap is below
// radii[i]+radii[j]; the push is split by radius² so the larger node moves less (matches
// d3-force). The octree search from each node is bounded by ri + per-cell max radius.
#[allow(clippy::too_many_arguments)]
fn apply_collide_tiered(
    tree: &mut Octree,
    pos: &[f32],
    vel: &mut [f32],
    radii: &[f32],
    cell_max_r: &mut Vec<f32>,
    n: usize,
    cpos: &mut Vec<f32>,
    pts: &mut Vec<u32>,
    scratch: &mut Vec<u32>,
    stack: &mut Vec<u32>,
    lcg: &mut Lcg,
) {
    if n == 0 {
        return;
    }
    cpos.resize(n * 3, 0.0);
    for i in 0..n * 3 {
        cpos[i] = pos[i] + vel[i];
    }
    if pts.len() != n {
        pts.resize(n, 0);
        for i in 0..n {
            pts[i] = i as u32;
        }
    }
    tree.build(cpos, pts, scratch);
    compute_cell_max_r(tree, radii, cell_max_r);
    for i in 0..n {
        let p = i * 3;
        let xi = cpos[p];
        let yi = cpos[p + 1];
        let zi = cpos[p + 2];
        let ri = radii[i];
        stack.clear();
        stack.push(0);
        while let Some(cell) = stack.pop() {
            let c = cell as usize;
            let is_leaf = tree.leaf_start[c] != u32::MAX;
            // reach = ri + cell_max_r catches any j in this cell whose (ri+rj) could overlap i
            let hx = tree.half[c] + ri + cell_max_r[c];
            if (tree.cx[c] - xi).abs() > hx
                || (tree.cy[c] - yi).abs() > hx
                || (tree.cz[c] - zi).abs() > hx
            {
                continue;
            }
            if is_leaf {
                let s = tree.leaf_start[c] as usize;
                let e = s + tree.leaf_len[c] as usize;
                for k in s..e {
                    let j = tree.order[k] as usize;
                    if j <= i {
                        continue; // each pair once
                    }
                    let rj = radii[j];
                    let rr = ri + rj;
                    let rr2 = rr * rr;
                    let jp = j * 3;
                    let mut dx = xi - cpos[jp];
                    let mut dy = yi - cpos[jp + 1];
                    let mut dz = zi - cpos[jp + 2];
                    let mut l = dx * dx + dy * dy + dz * dz;
                    if l < rr2 {
                        if dx == 0.0 { dx = lcg.jiggle(); l += dx * dx; }
                        if dy == 0.0 { dy = lcg.jiggle(); l += dy * dy; }
                        if dz == 0.0 { dz = lcg.jiggle(); l += dz * dz; }
                        let ld = l.sqrt();
                        let f = (rr - ld) / ld; // strength 1
                        dx *= f;
                        dy *= f;
                        dz *= f;
                        // split by radius²: node i takes rj²/(ri²+rj²), j takes ri²/(ri²+rj²)
                        let ri2 = ri * ri;
                        let rj2 = rj * rj;
                        let sum = ri2 + rj2;
                        let (si, sj) = if sum > 0.0 { (rj2 / sum, ri2 / sum) } else { (0.5, 0.5) };
                        vel[p] += dx * si;
                        vel[p + 1] += dy * si;
                        vel[p + 2] += dz * si;
                        vel[jp] -= dx * sj;
                        vel[jp + 1] -= dy * sj;
                        vel[jp + 2] -= dz * sj;
                    }
                }
            } else {
                let kids = tree.children[c];
                for &ch in kids.iter() {
                    if ch != NO_CHILD {
                        stack.push(ch);
                    }
                }
            }
        }
    }
}

// ── main entry ────────────────────────────────────────────────────────────────
// pos: *mut f32 [3n] in/out. charge: *const f32 [n]. links: *const u32 [2*m].
// Returns total ticks run (phase1 + phase2) in the low 16 bits, phase1 ticks in high 16.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn run_core(
    n: usize,
    pos_ptr: *mut f32,
    charge_ptr: *const f32,
    m: usize,
    links_ptr: *const u32,
    link_distance: f32,
    link_strength: f32,
    charge_dist_min2: f32,
    theta2: f32,
    center_strength: f32,
    alpha_decay: f32,
    velocity_decay: f32,
    max_ticks: u32,
    alpha_min: f32,
    early_exit_vel: f32,
    collide_radius: f32,
    collide_ticks: u32,
) -> u32 {
    let pos = std::slice::from_raw_parts_mut(pos_ptr, n * 3);
    let charge = std::slice::from_raw_parts(charge_ptr, n);
    let links = std::slice::from_raw_parts(links_ptr, m * 2);

    let mut vel = vec![0.0f32; n * 3];

    // link degree counts + bias[i] = count[src]/(count[src]+count[tgt])
    let mut count = vec![0u32; n];
    for i in 0..m {
        count[links[i * 2] as usize] += 1;
        count[links[i * 2 + 1] as usize] += 1;
    }
    let mut bias = vec![0.0f32; m];
    for i in 0..m {
        let cs = count[links[i * 2] as usize] as f32;
        let ct = count[links[i * 2 + 1] as usize] as f32;
        bias[i] = cs / (cs + ct);
    }

    let mut tree = Octree::with_capacity(n);
    let mut pts: Vec<u32> = (0..n as u32).collect();
    let mut scratch: Vec<u32> = vec![0; n];
    let mut stack: Vec<u32> = Vec::with_capacity(64);
    let mut cpos: Vec<f32> = Vec::with_capacity(n * 3);
    let mut cpts: Vec<u32> = (0..n as u32).collect();
    let mut cscratch: Vec<u32> = vec![0; n];
    let mut lcg = Lcg::new();

    let mut alpha = 1.0f32;
    let mut ticks: u32 = 0;
    let mut stable = 0u32;
    let mut phase1_ticks: u32 = 0;

    // phase 1: collide-free convergence
    loop {
        if ticks >= max_ticks || alpha < alpha_min {
            break;
        }
        alpha += (0.0 - alpha) * alpha_decay;

        apply_link(pos, &mut vel, links, &bias, link_distance, link_strength, alpha, &mut lcg);
        pts.clear();
        pts.extend(0..n as u32);
        tree.build(pos, &mut pts, &mut scratch);
        tree.accumulate_charge(pos, charge);
        apply_manybody(&tree, pos, &mut vel, charge, alpha, theta2, charge_dist_min2, &mut lcg, &mut stack, n);
        apply_center(pos, n, center_strength);

        // integrate + mean velocity
        let mut total_v = 0.0f32;
        for i in 0..n {
            let p = i * 3;
            vel[p] *= velocity_decay;
            vel[p + 1] *= velocity_decay;
            vel[p + 2] *= velocity_decay;
            pos[p] += vel[p];
            pos[p + 1] += vel[p + 1];
            pos[p + 2] += vel[p + 2];
            total_v += (vel[p] * vel[p] + vel[p + 1] * vel[p + 1] + vel[p + 2] * vel[p + 2]).sqrt();
        }
        ticks += 1;
        phase1_ticks = ticks;
        if total_v / (n as f32) < early_exit_vel {
            stable += 1;
            if stable >= 3 {
                break;
            }
        } else {
            stable = 0;
        }
    }

    // phase 2: add collide, fixed tick budget
    for _ in 0..collide_ticks {
        alpha += (0.0 - alpha) * alpha_decay;
        apply_link(pos, &mut vel, links, &bias, link_distance, link_strength, alpha, &mut lcg);
        pts.clear();
        pts.extend(0..n as u32);
        tree.build(pos, &mut pts, &mut scratch);
        tree.accumulate_charge(pos, charge);
        apply_manybody(&tree, pos, &mut vel, charge, alpha, theta2, charge_dist_min2, &mut lcg, &mut stack, n);
        apply_center(pos, n, center_strength);
        apply_collide(&mut tree, pos, &mut vel, collide_radius, n, &mut cpos, &mut cpts, &mut cscratch, &mut stack, &mut lcg);
        for i in 0..n {
            let p = i * 3;
            vel[p] *= velocity_decay;
            vel[p + 1] *= velocity_decay;
            vel[p + 2] *= velocity_decay;
            pos[p] += vel[p];
            pos[p + 1] += vel[p + 1];
            pos[p + 2] += vel[p + 2];
        }
        ticks += 1;
    }

    (phase1_ticks << 16) | (ticks & 0xFFFF)
}

// Standalone collide pass over the full node set (the JS "polish" step).
// pos in/out [3n]; runs `iters` collide-only ticks (no charge/link/center).
#[no_mangle]
pub unsafe extern "C" fn run_polish(
    n: usize,
    pos_ptr: *mut f32,
    radius: f32,
    velocity_decay: f32,
    iters: u32,
) {
    let pos = std::slice::from_raw_parts_mut(pos_ptr, n * 3);
    let mut vel = vec![0.0f32; n * 3];
    let mut tree = Octree::with_capacity(n);
    let mut cpos: Vec<f32> = Vec::with_capacity(n * 3);
    let mut cpts: Vec<u32> = (0..n as u32).collect();
    let mut cscratch: Vec<u32> = vec![0; n];
    let mut stack: Vec<u32> = Vec::with_capacity(64);
    let mut lcg = Lcg::new();
    for _ in 0..iters {
        apply_collide(&mut tree, pos, &mut vel, radius, n, &mut cpos, &mut cpts, &mut cscratch, &mut stack, &mut lcg);
        for i in 0..n {
            let p = i * 3;
            vel[p] *= velocity_decay;
            vel[p + 1] *= velocity_decay;
            vel[p + 2] *= velocity_decay;
            pos[p] += vel[p];
            pos[p + 1] += vel[p + 1];
            pos[p + 2] += vel[p + 2];
        }
    }
}

// pos in/out [3n]; radii [n] per-node collide radius. Runs `iters` per-tier collide-only
// ticks (no charge/link/center) — the fast Rust path for baking supernode/ultranode
// min-distance into the layout, replacing the JS d3 collide.
#[no_mangle]
pub unsafe extern "C" fn run_polish_tiered(
    n: usize,
    pos_ptr: *mut f32,
    radii_ptr: *const f32,
    velocity_decay: f32,
    iters: u32,
) {
    let pos = std::slice::from_raw_parts_mut(pos_ptr, n * 3);
    let radii = std::slice::from_raw_parts(radii_ptr, n);
    let mut vel = vec![0.0f32; n * 3];
    let mut tree = Octree::with_capacity(n);
    let mut cpos: Vec<f32> = Vec::with_capacity(n * 3);
    let mut cpts: Vec<u32> = (0..n as u32).collect();
    let mut cscratch: Vec<u32> = vec![0; n];
    let mut stack: Vec<u32> = Vec::with_capacity(64);
    let mut cell_max_r: Vec<f32> = Vec::with_capacity(2 * n);
    let mut lcg = Lcg::new();
    for _ in 0..iters {
        apply_collide_tiered(&mut tree, pos, &mut vel, radii, &mut cell_max_r, n, &mut cpos, &mut cpts, &mut cscratch, &mut stack, &mut lcg);
        for i in 0..n {
            let p = i * 3;
            vel[p] *= velocity_decay;
            vel[p + 1] *= velocity_decay;
            vel[p + 2] *= velocity_decay;
            pos[p] += vel[p];
            pos[p + 1] += vel[p + 1];
            pos[p + 2] += vel[p + 2];
        }
    }
}
