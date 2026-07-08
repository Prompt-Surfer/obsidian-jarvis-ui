// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from 'd3-force-3d'
import wasmUrl from './force_sim.wasm?url'
import type { GraphShape, ImportedShapeDef } from '../shapes/types'
import { getImportedShape, resolveImportedShape, mulberry32 } from '../shapes/registry'

// ── Rust/WASM natural-layout core (optional accelerator) ─────────────────────
// Plain wasm (no wasm-bindgen): JS allocs buffers, writes f32/u32 arrays into
// linear memory, calls run_core/run_polish, reads positions back. Loaded lazily;
// any failure falls back to the d3-force-3d path so the graph never breaks.
interface ForceWasm {
  memory: WebAssembly.Memory
  alloc(size: number): number
  dealloc(ptr: number, size: number): void
  run_core(
    n: number, posPtr: number, chargePtr: number, m: number, linksPtr: number,
    linkDistance: number, linkStrength: number, chargeDistMin2: number, theta2: number,
    centerStrength: number, alphaDecay: number, velocityDecay: number,
    maxTicks: number, alphaMin: number, earlyExitVel: number,
    collideRadius: number, collideTicks: number,
  ): number
  run_polish(n: number, posPtr: number, radius: number, velocityDecay: number, iters: number): void
  // Per-node-radius collide polish (radiiPtr → f32[n]): bakes per-tier min-distance in Rust.
  run_polish_tiered(n: number, posPtr: number, radiiPtr: number, velocityDecay: number, iters: number): void
}
let wasmPromise: Promise<ForceWasm | null> | null = null
function loadForceWasm(): Promise<ForceWasm | null> {
  if (wasmPromise) return wasmPromise
  wasmPromise = (async () => {
    try {
      const resp = await fetch(wasmUrl)
      const { instance } = await WebAssembly.instantiate(await resp.arrayBuffer(), {})
      const ex = instance.exports as unknown as ForceWasm
      if (typeof ex.run_core !== 'function' || typeof ex.alloc !== 'function') return null
      return ex
    } catch {
      return null // fall back to d3-force-3d
    }
  })()
  return wasmPromise
}

// Low-poly brain mesh vertices (CC Attribution, Poly by Google) — 1035 surface points, unit scale
// prettier-ignore
const BRAIN_MESH: [number,number,number][] = [[0.213,-0.633,0.283],[0.425,-0.628,0.147],[0.458,-0.661,0.271],[-0.229,-0.217,0.028],[-0.323,-0.252,0.156],[-0.207,-0.140,0.163],[0.193,0.050,0.474],[0.217,0.045,0.752],[0.185,0.162,0.695],[0.134,-0.281,-0.061],[0.152,-0.340,0.048],[0.010,-0.117,-0.027],[-0.412,0.206,-0.039],[-0.453,0.221,-0.158],[-0.272,0.289,-0.157],[0.541,-0.337,0.363],[0.657,-0.354,0.134],[0.584,-0.327,0.149],[0.468,0.153,-0.020],[0.256,0.279,-0.033],[0.398,0.099,-0.011],[0.234,-0.138,-0.081],[0.192,-0.228,-0.103],[0.223,-0.223,0.031],[0.142,-0.555,-0.507],[0.029,-0.458,-0.338],[0.116,-0.437,-0.563],[0.310,0.102,-0.294],[0.292,0.061,-0.368],[0.455,0.061,-0.362],[-0.259,0.148,-0.327],[-0.235,-0.029,-0.417],[-0.339,0.006,-0.433],[-0.081,-0.158,-0.191],[0.018,-0.140,-0.263],[0.116,-0.231,-0.147],[-0.209,0.223,0.024],[0.213,-0.540,-0.142],[0.108,-0.567,-0.286],[0.203,-0.648,-0.207],[-0.235,-0.142,0.414],[0.034,-0.111,0.477],[-0.235,-0.029,0.401],[-0.174,0.135,-0.681],[-0.213,0.020,-0.616],[-0.282,0.083,-0.662],[-0.021,0.327,0.035],[0.110,0.285,0.033],[0.102,0.295,-0.052],[0.257,-0.750,0.076],[0.260,-0.751,-0.089],[0.234,-0.628,-0.022],[-0.106,0.065,-0.620],[0.018,-0.138,0.263],[-0.023,-0.178,0.187],[-0.059,-0.133,0.240],[-0.745,-0.095,-0.016],[-0.844,-0.141,-0.083],[-0.752,-0.257,0.033],[-0.013,0.654,-0.101],[-0.070,0.615,-0.140],[-0.093,0.729,-0.077],[0.101,-0.159,-0.141],[0.211,-0.082,-0.206],[0.123,-0.134,-0.249],[0.119,-0.108,0.009],[0.132,-0.231,0.119],[0.111,-0.561,0.261],[0.242,-0.653,0.396],[0.322,-0.652,-0.262],[0.199,-0.629,-0.313],[0.205,-0.646,-0.426],[0.027,0.544,-0.434],[0.102,0.626,-0.284],[0.111,0.578,-0.355],[-0.079,-0.330,0.236],[0.093,-0.243,0.374],[0.440,-0.313,-0.571],[0.447,-0.261,-0.621],[0.520,-0.262,-0.530],[0.532,0.376,0.303],[0.672,0.361,0.233],[0.555,0.474,0.248],[-0.508,-0.167,0.463],[-0.643,-0.142,0.475],[-0.527,-0.178,0.407],[0.391,0.365,-0.534],[0.395,0.450,-0.517],[0.516,0.371,-0.467],[-0.048,0.428,-0.017],[-0.021,0.366,-0.032],[0.220,-0.390,0.500],[0.440,-0.338,0.573],[0.335,-0.389,0.560],[-0.824,0.422,-0.140],[-0.915,0.303,-0.195],[0.090,-0.099,0.366],[0.169,-0.005,0.286],[0.237,-0.017,0.379],[0.110,0.507,0.484],[0.091,0.608,0.353],[-0.239,-0.134,-0.431],[0.025,-0.112,-0.490],[-0.180,-0.189,-0.401],[0.015,-0.042,-0.036],[0.015,0.085,-0.032],[-0.375,-0.013,0.025],[-0.327,-0.044,-0.037],[-0.375,-0.006,-0.025],[-0.394,-0.200,0.372],[-0.490,-0.084,0.547],[0.050,-0.107,-0.362],[-0.047,-0.102,-0.292],[0.340,-0.579,-0.069],[0.378,-0.596,0.029],[0.239,-0.559,0.070],[0.808,0.229,0.077],[0.816,0.181,0.158],[0.794,0.097,0.048],[-0.386,0.047,-0.392],[-0.479,-0.036,-0.393],[-0.456,-0.049,-0.417],[-0.621,0.016,0.571],[-0.485,-0.013,0.557],[-0.686,0.114,0.530],[-0.526,0.086,0.168],[-0.332,0.240,0.152],[-0.454,-0.033,0.133],[0.237,0.229,0.031],[0.256,0.279,0.054],[0.136,0.088,0.036],[0.161,0.009,0.021],[-0.240,0.211,-0.022],[0.480,-0.250,0.256],[0.394,-0.314,0.377],[0.027,0.306,0.686],[0.086,0.424,0.610],[-0.003,0.397,0.572],[0.157,0.068,-0.062],[0.209,0.082,0.016],[0.042,-0.348,0.185],[0.125,-0.540,0.158],[0.777,-0.072,0.410],[0.779,0.113,0.387],[0.063,-0.338,0.675],[-0.233,-0.427,0.535],[-0.038,-0.409,0.549],[-0.282,0.531,-0.299],[-0.292,0.606,-0.266],[-0.219,0.657,-0.255],[0.542,0.102,-0.037],[0.609,0.132,0.011],[0.572,0.147,-0.022],[0.332,-0.315,0.450],[-0.276,-0.131,0.042],[-0.324,-0.030,0.025],[0.104,-0.157,0.142],[0.020,0.061,0.031],[-0.369,-0.386,-0.504],[-0.393,-0.434,-0.367],[-0.448,-0.398,-0.468],[-0.345,-0.202,0.440],[-0.435,-0.159,0.433],[-0.241,-0.130,0.454],[-0.099,-0.301,-0.064],[-0.105,-0.291,0.079],[-0.037,-0.255,0.043],[-0.167,0.705,0.145],[-0.108,0.715,0.027],[-0.316,0.695,0.058],[-0.658,0.585,-0.068],[-0.611,0.568,-0.092],[-0.737,0.480,-0.030],[0.876,0.089,0.155],[-0.279,-0.122,-0.058],[-0.327,-0.222,-0.067],[-0.206,-0.435,-0.499],[-0.292,-0.385,-0.456],[0.123,0.699,0.039],[0.086,0.158,0.011],[0.042,0.165,-0.030],[0.822,-0.006,0.254],[0.790,0.105,0.277],[0.825,-0.067,0.333],[0.222,0.396,0.063],[0.336,0.413,0.035],[-0.309,0.141,-0.377],[-0.047,0.316,-0.273],[-0.262,0.288,-0.240],[0.145,-0.752,-0.065],[0.130,-0.651,-0.136],[-0.511,0.104,0.019],[-0.410,0.212,-0.583],[-0.291,0.230,-0.579],[0.216,0.082,-0.388],[0.019,0.033,-0.582],[0.008,0.074,-0.504],[0.558,-0.205,0.170],[-0.274,0.215,-0.032],[-0.280,0.189,0.013],[-0.951,-0.053,-0.182],[-0.837,-0.113,-0.190],[-0.919,-0.093,-0.125],[-0.061,0.048,-0.734],[0.007,0.082,-0.645],[0.138,0.090,-0.702],[0.299,0.088,0.023],[0.028,0.210,-0.362],[0.137,0.226,-0.285],[-0.748,0.200,-0.451],[-0.785,0.119,-0.451],[-0.920,0.169,-0.333],[0.211,-0.082,0.227],[0.189,-0.058,0.285],[0.151,0.085,0.140],[0.616,0.123,-0.575],[0.602,0.226,-0.523],[0.654,0.116,-0.512],[0.669,-0.377,-0.158],[0.528,-0.348,-0.372],[0.585,-0.366,-0.316],[0.207,-0.444,-0.096],[0.091,-0.254,-0.007],[0.143,0.270,0.714],[-0.450,-0.298,0.166],[-0.531,-0.383,0.252],[-0.504,-0.254,0.226],[-0.298,-0.177,0.193],[-0.917,0.070,-0.354],[0.301,-0.646,-0.477],[-0.341,0.113,0.009],[0.129,0.511,-0.042],[-0.058,0.491,-0.057],[0.143,0.430,-0.021],[0.772,-0.411,0.057],[-0.295,0.300,0.026],[0.749,0.199,0.332],[0.479,0.109,-0.625],[0.580,-0.026,-0.597],[-0.346,-0.285,0.626],[-0.393,-0.237,0.594],[-0.369,-0.386,0.525],[-0.932,0.124,-0.028],[-0.863,0.238,0.011],[-0.973,0.178,-0.086],[0.573,-0.040,0.588],[0.490,-0.057,0.694],[0.474,-0.150,0.640],[-0.345,-0.198,0.655],[-0.457,-0.150,0.623],[0.347,-0.248,0.673],[0.447,-0.261,0.642],[0.859,0.057,0.228],[0.496,0.293,0.011],[0.475,-0.591,-0.494],[0.427,-0.521,-0.594],[0.512,-0.542,-0.507],[-0.914,0.317,0.146],[-0.824,0.422,0.161],[-0.096,0.611,-0.292],[-0.029,0.690,-0.163],[-0.061,-0.413,0.159],[0.002,-0.437,0.206],[0.079,-0.354,0.169],[-0.139,0.163,0.405],[-0.049,0.097,0.452],[-0.126,0.052,0.571],[-0.530,0.342,-0.452],[-0.558,0.438,-0.395],[-0.449,0.469,-0.403],[-0.054,0.560,-0.309],[0.322,-0.147,-0.112],[0.143,-0.301,-0.263],[-0.027,0.419,-0.559],[-0.060,0.506,-0.406],[-0.077,0.013,0.390],[-0.008,-0.018,0.440],[-0.483,-0.097,0.011],[-0.493,-0.003,-0.022],[-0.582,0.099,-0.023],[0.252,-0.283,0.341],[0.229,-0.291,0.419],[0.910,-0.129,0.128],[0.870,-0.147,0.254],[0.152,-0.249,0.245],[-0.128,-0.153,0.005],[-0.605,0.481,-0.285],[-0.708,0.421,-0.243],[-0.526,0.528,-0.285],[0.572,0.147,0.043],[0.468,0.153,0.041],[0.246,-0.020,0.030],[-0.030,-0.287,-0.174],[-0.192,0.535,0.452],[-0.116,0.602,0.343],[-0.219,0.657,0.276],[-0.316,0.695,-0.037],[-0.310,0.661,-0.222],[-0.426,0.634,-0.222],[0.014,0.107,0.671],[-0.092,0.074,0.667],[0.794,0.097,-0.027],[0.816,0.181,-0.137],[0.808,0.229,-0.056],[0.430,0.495,0.321],[0.321,0.499,0.424],[-0.745,-0.095,0.037],[-0.803,-0.094,0.067],[-0.690,0.045,0.011],[-0.039,-0.311,0.683],[-0.199,-0.243,0.676],[-0.162,-0.336,0.605],[-0.531,-0.379,-0.345],[-0.532,-0.322,-0.466],[0.228,0.701,0.073],[0.352,0.620,0.185],[0.478,0.607,0.118],[0.522,0.418,-0.300],[0.440,0.519,-0.271],[0.090,0.709,-0.046],[-0.325,-0.362,0.599],[0.113,0.509,-0.476],[0.021,0.376,-0.543],[0.143,0.430,0.042],[-0.048,0.428,0.038],[-0.058,0.491,0.078],[-0.221,-0.321,-0.045],[-0.201,-0.424,-0.073],[-0.246,-0.364,-0.130],[-0.234,0.102,0.046],[-0.200,0.298,0.025],[-0.524,-0.168,-0.416],[-0.435,-0.159,-0.412],[-0.396,-0.020,-0.584],[0.108,-0.360,-0.392],[0.035,-0.335,-0.217],[0.249,0.335,0.664],[0.345,0.308,0.633],[0.627,-0.550,-0.354],[0.653,-0.412,-0.389],[0.649,-0.568,-0.232],[0.400,0.486,-0.433],[0.568,0.386,-0.396],[-0.937,-0.018,-0.047],[-0.679,0.453,-0.332],[-0.744,0.341,-0.378],[-0.097,-0.326,-0.168],[-0.016,-0.435,-0.203],[0.742,-0.103,0.020],[0.805,0.010,0.011],[0.458,0.423,0.037],[-0.276,-0.479,0.363],[-0.223,-0.433,0.276],[-0.205,-0.415,0.369],[0.444,-0.216,-0.172],[0.564,-0.310,-0.169],[0.448,-0.338,-0.308],[0.722,-0.422,0.211],[0.640,-0.432,0.387],[0.551,-0.391,0.427],[0.140,0.614,0.268],[0.187,0.641,0.294],[0.229,0.628,0.198],[-0.446,-0.266,-0.022],[-0.542,-0.213,-0.067],[-0.302,0.542,-0.382],[0.210,-0.067,0.157],[0.531,-0.647,-0.316],[0.300,-0.611,-0.580],[0.478,0.165,-0.637],[0.439,0.266,-0.635],[0.538,0.289,-0.566],[-0.323,0.606,0.328],[-0.426,0.634,0.243],[-0.493,0.601,0.258],[0.294,-0.422,-0.644],[0.252,-0.461,-0.605],[0.339,-0.387,-0.565],[-0.311,-0.372,-0.053],[-0.298,-0.306,0.009],[0.576,0.492,-0.063],[0.478,0.607,-0.097],[0.341,-0.650,0.074],[0.888,-0.212,0.029],[0.854,-0.041,0.011],[0.019,0.190,0.020],[-0.385,-0.021,0.579],[-0.201,0.003,0.658],[-0.810,-0.091,-0.330],[-0.817,-0.025,-0.454],[-0.708,-0.103,-0.388],[0.624,0.115,0.573],[0.602,0.226,0.544],[0.538,0.289,0.587],[0.338,0.641,-0.017],[0.228,0.701,-0.052],[-0.384,0.518,0.011],[-0.263,0.529,0.045],[-0.414,0.447,0.059],[-0.414,-0.258,0.296],[0.796,-0.346,-0.259],[0.855,-0.326,-0.194],[0.722,-0.422,-0.190],[-0.504,-0.254,-0.205],[-0.644,-0.156,-0.154],[-0.029,0.690,0.184],[0.095,0.686,0.195],[-0.013,0.654,0.122],[-0.812,0.296,0.019],[-0.593,0.386,0.011],[-0.187,0.540,0.011],[-0.055,-0.347,-0.414],[-0.004,-0.348,-0.454],[0.636,-0.556,-0.138],[0.610,-0.611,-0.289],[-0.107,0.321,0.040],[-0.103,0.226,0.017],[-0.223,-0.218,-0.055],[0.542,0.102,0.058],[0.576,-0.034,0.011],[-0.229,0.182,-0.666],[-0.118,-0.258,-0.363],[-0.209,-0.252,-0.283],[-0.173,-0.202,-0.215],[-0.712,-0.097,0.466],[0.729,0.294,-0.051],[0.709,0.290,-0.187],[0.661,0.381,-0.193],[-0.511,0.191,0.024],[-0.302,0.358,0.033],[0.668,0.439,-0.038],[-0.272,0.289,0.178],[0.028,0.279,0.189],[-0.175,0.112,-0.073],[-0.490,-0.005,0.024],[-0.325,0.304,0.512],[-0.512,0.304,0.461],[-0.443,0.313,0.546],[0.106,0.099,0.436],[0.539,0.422,0.374],[0.616,0.343,0.384],[-0.276,-0.479,-0.342],[-0.205,-0.415,-0.348],[0.346,0.375,-0.050],[0.691,-0.012,-0.521],[0.187,0.641,-0.273],[-0.211,-0.175,-0.622],[-0.070,-0.159,-0.667],[-0.171,-0.224,-0.675],[-0.404,0.682,-0.086],[-0.510,0.645,-0.049],[-0.493,-0.034,-0.507],[-0.493,-0.128,-0.487],[-0.162,-0.336,-0.584],[-0.325,-0.362,-0.578],[-0.218,-0.256,-0.641],[-0.193,0.088,0.388],[0.151,-0.553,-0.563],[0.082,-0.347,-0.446],[-0.038,-0.409,-0.528],[-0.163,0.055,0.466],[-0.309,0.141,0.398],[0.259,0.229,-0.063],[-0.027,0.341,-0.073],[-0.094,0.078,0.008],[-0.125,0.073,-0.032],[0.103,-0.492,-0.299],[-0.020,0.127,-0.416],[0.073,0.284,-0.305],[0.266,-0.122,0.704],[0.191,-0.186,0.717],[0.340,-0.144,0.719],[-0.517,-0.101,0.279],[-0.520,-0.030,0.376],[0.753,-0.155,-0.021],[0.687,-0.196,0.011],[0.222,0.396,-0.042],[-0.572,-0.307,-0.279],[-0.883,-0.072,0.055],[-0.810,-0.091,0.351],[-0.817,-0.025,0.475],[-0.759,0.290,-0.320],[-0.840,0.294,-0.282],[-0.427,0.210,0.026],[-0.363,0.278,0.053],[0.545,-0.296,-0.075],[-0.204,0.709,0.011],[0.259,-0.826,0.111],[0.301,-0.854,0.043],[0.175,0.190,0.212],[-0.043,0.259,0.159],[0.032,0.268,0.275],[-0.070,0.615,0.161],[-0.804,0.281,-0.360],[-0.104,-0.427,0.047],[0.348,-0.676,-0.146],[0.729,0.294,0.072],[0.583,-0.425,-0.475],[0.495,-0.229,0.125],[0.769,-0.355,0.011],[0.184,0.055,-0.500],[0.113,0.113,-0.417],[-0.008,0.105,0.474],[0.019,0.033,0.603],[-0.163,0.055,-0.445],[-0.139,0.163,-0.384],[0.581,0.461,-0.020],[0.666,0.337,0.011],[0.490,-0.057,-0.673],[0.474,-0.150,-0.619],[0.371,-0.238,-0.663],[0.292,0.010,0.036],[0.303,0.087,-0.013],[0.459,-0.383,-0.499],[0.245,-0.335,-0.416],[-0.363,-0.015,-0.505],[0.851,-0.308,0.066],[0.225,0.577,0.434],[0.007,-0.020,-0.747],[0.134,0.008,-0.757],[0.668,0.439,0.059],[0.241,-0.034,-0.045],[0.178,0.002,-0.055],[0.210,-0.067,-0.136],[-0.318,-0.201,-0.285],[-0.317,-0.257,-0.155],[-0.351,-0.137,0.347],[-0.428,-0.061,0.311],[-0.391,-0.125,0.255],[0.191,-0.186,-0.696],[0.030,-0.200,-0.709],[0.027,-0.105,-0.709],[-0.075,0.188,-0.012],[0.372,0.026,0.750],[0.203,-0.062,0.768],[0.383,-0.029,0.710],[0.020,0.180,0.721],[-0.920,0.169,0.354],[-0.917,0.070,0.375],[-0.785,0.119,0.472],[0.196,-0.121,0.103],[0.184,-0.537,0.133],[-0.865,0.353,-0.015],[-0.110,-0.315,0.601],[0.119,-0.374,0.364],[0.293,-0.368,0.415],[0.376,-0.334,0.291],[0.322,-0.636,0.496],[0.552,-0.636,0.281],[0.451,-0.572,0.500],[-0.915,0.131,0.254],[-0.883,0.255,0.270],[0.478,0.165,0.658],[0.561,-0.448,-0.063],[0.504,-0.554,-0.063],[0.621,-0.503,-0.095],[-0.708,0.421,0.265],[-0.718,0.534,0.160],[0.649,-0.111,0.493],[0.691,-0.012,0.542],[0.189,-0.058,-0.264],[-0.274,-0.080,0.496],[0.439,0.266,0.656],[0.330,0.123,0.730],[-0.624,0.463,0.334],[-0.560,0.525,0.327],[-0.568,-0.184,-0.537],[-0.393,-0.237,-0.573],[0.237,-0.018,-0.394],[0.220,-0.015,-0.444],[-0.526,0.090,-0.165],[-0.472,0.064,-0.060],[-0.560,-0.031,-0.168],[0.338,0.641,0.038],[-0.053,-0.321,0.325],[0.222,0.346,-0.618],[0.284,0.321,-0.674],[0.143,0.270,-0.693],[0.726,-0.304,-0.413],[0.153,-0.552,0.529],[0.295,-0.523,0.595],[0.145,-0.493,0.521],[0.145,-0.112,-0.667],[0.266,-0.122,-0.683],[0.489,-0.564,0.039],[0.240,-0.663,0.170],[-0.346,0.245,0.216],[-0.379,0.061,0.363],[-0.207,0.207,0.298],[0.481,0.078,0.673],[0.284,-0.141,0.070],[-0.449,0.469,0.424],[-0.558,0.438,0.416],[-0.023,-0.363,0.384],[-0.347,-0.136,-0.365],[-0.256,-0.166,-0.278],[-0.491,0.172,-0.019],[-0.600,0.265,-0.483],[-0.652,0.348,-0.402],[-0.192,0.709,-0.085],[-0.446,-0.266,0.043],[0.195,0.186,0.346],[0.233,0.195,0.255],[0.300,0.080,0.355],[0.822,-0.006,-0.233],[0.890,-0.097,-0.210],[0.825,-0.067,-0.311],[0.615,-0.324,-0.080],[0.682,-0.453,-0.170],[-0.196,-0.126,-0.697],[0.765,0.249,0.242],[-0.443,0.313,-0.525],[0.767,-0.258,-0.273],[0.020,0.180,-0.700],[0.317,0.282,-0.697],[0.217,0.045,-0.731],[0.185,0.162,-0.674],[-0.273,0.333,-0.034],[-0.302,0.358,-0.012],[-0.633,0.510,0.251],[-0.481,0.531,0.280],[0.321,-0.126,0.355],[0.316,-0.108,0.297],[0.772,-0.411,-0.036],[0.640,0.417,0.182],[0.546,-0.239,0.567],[0.590,0.025,0.644],[-0.223,-0.433,-0.255],[-0.275,-0.332,-0.140],[-0.357,-0.399,-0.144],[-0.488,-0.101,0.169],[-0.560,-0.031,0.189],[0.101,0.516,0.035],[-0.183,-0.005,-0.037],[-0.221,0.330,-0.064],[-0.101,0.325,-0.065],[0.166,-0.612,0.460],[0.281,-0.593,0.558],[-0.479,0.508,0.011],[-0.737,0.480,0.051],[-0.488,0.644,0.035],[-0.414,0.447,-0.038],[0.321,0.499,-0.403],[-0.395,0.397,0.515],[-0.191,0.090,-0.402],[0.493,-0.198,-0.085],[0.480,-0.138,-0.039],[0.362,-0.175,-0.153],[-0.368,0.063,-0.583],[0.855,-0.326,0.215],[0.804,-0.224,0.266],[0.796,-0.346,0.280],[0.127,-0.540,-0.185],[0.227,-0.470,0.079],[0.290,-0.009,-0.038],[-0.357,-0.399,0.165],[-0.686,0.114,-0.509],[-0.621,0.016,-0.550],[-0.104,-0.222,0.356],[-0.269,-0.412,0.071],[0.762,-0.260,0.347],[-0.291,0.230,0.600],[-0.410,0.212,0.604],[-0.023,-0.178,-0.166],[0.590,-0.402,0.467],[0.456,0.558,0.248],[-0.560,-0.024,-0.317],[-0.399,-0.189,-0.371],[0.744,-0.106,0.399],[-0.002,-0.561,0.077],[0.005,-0.566,-0.096],[0.203,-0.062,-0.747],[0.332,-0.315,-0.429],[0.220,-0.390,-0.479],[-0.229,0.182,0.687],[-0.138,0.210,0.692],[-0.402,-0.249,-0.281],[-0.643,-0.142,-0.454],[-0.191,-0.227,0.270],[0.266,0.505,-0.490],[0.033,-0.466,0.321],[-0.081,0.022,-0.416],[-0.078,0.079,-0.470],[-0.363,0.278,-0.032],[0.528,-0.647,-0.189],[-0.147,-0.452,0.485],[-0.004,-0.348,0.475],[-0.227,-0.116,-0.112],[0.874,0.065,-0.179],[0.910,-0.129,-0.107],[-0.595,0.604,-0.143],[0.030,-0.200,0.730],[0.101,-0.261,0.662],[0.136,0.412,-0.604],[0.558,-0.205,-0.149],[-0.825,0.074,0.391],[-0.856,-0.008,0.419],[-0.531,-0.383,-0.231],[-0.432,-0.328,-0.164],[-0.505,0.288,-0.434],[-0.584,0.165,-0.503],[0.400,0.486,0.455],[0.160,-0.166,-0.035],[-0.626,0.307,0.464],[-0.076,0.620,0.283],[-0.396,-0.390,0.222],[0.389,-0.018,0.274],[0.462,0.003,0.327],[-0.007,0.599,0.011],[-0.846,0.093,0.021],[-0.980,0.082,-0.149],[0.616,0.343,-0.363],[0.692,0.198,-0.374],[0.377,0.001,-0.711],[0.483,0.047,-0.679],[-0.341,-0.471,-0.238],[0.777,-0.072,-0.389],[0.058,0.289,-0.678],[0.229,0.175,-0.240],[0.168,-0.001,-0.295],[0.305,0.099,0.238],[-0.393,-0.434,0.388],[-0.341,-0.471,0.259],[0.295,0.157,0.031],[0.132,0.088,-0.169],[-0.078,0.157,-0.127],[-0.372,0.069,0.016],[0.169,-0.055,-0.134],[-0.084,0.731,0.123],[-0.184,-0.013,0.026],[0.236,-0.263,0.242],[0.199,-0.187,0.136],[-0.658,0.585,0.089],[-0.611,0.568,0.113],[-0.568,-0.184,0.558],[-0.580,-0.253,0.475],[-0.532,-0.322,0.487],[0.307,0.163,-0.051],[-0.912,-0.035,0.032],[-0.156,0.368,-0.501],[-0.307,0.412,-0.475],[-0.214,0.524,-0.406],[-0.748,0.200,0.472],[0.187,-0.310,0.058],[-0.055,-0.347,0.435],[-0.415,0.068,-0.302],[0.598,-0.303,0.545],[-0.404,0.682,0.107],[-0.537,0.645,0.113],[0.291,0.604,0.307],[-0.904,-0.131,-0.037],[-0.087,-0.171,0.157],[-0.274,-0.080,-0.475],[0.002,-0.031,-0.428],[-0.288,-0.235,0.013],[-0.693,0.017,0.523],[0.219,-0.877,0.041],[0.146,-0.751,0.052],[0.214,-0.871,-0.049],[-0.915,0.131,-0.233],[-0.401,-0.026,0.484],[-0.021,0.366,0.053],[-0.285,0.001,0.472],[-0.243,0.004,0.543],[-0.493,0.601,-0.237],[0.126,-0.243,-0.265],[0.238,-0.264,-0.280],[0.339,-0.222,-0.272],[-0.582,-0.203,0.403],[-0.932,0.124,0.049],[-0.980,0.082,0.170],[-0.973,0.178,0.107],[0.555,0.474,-0.227],[0.458,0.423,-0.016],[-0.292,-0.385,0.477],[-0.070,-0.159,0.688],[-0.010,-0.088,0.750],[-0.201,-0.142,0.693],[0.421,-0.064,-0.062],[0.303,-0.264,-0.633],[0.636,-0.414,0.050],[0.692,-0.470,0.164],[0.576,0.474,0.127],[0.201,0.136,-0.055],[-0.488,-0.101,-0.148],[-0.517,-0.101,-0.258],[0.099,-0.579,-0.428],[-0.145,0.701,-0.157],[0.081,-0.399,-0.407],[0.130,-0.650,0.121],[-0.307,0.412,0.496],[0.025,0.714,0.011],[-0.243,0.004,-0.521],[0.226,-0.342,0.649],[0.080,-0.399,0.593],[-0.385,-0.259,-0.124],[0.119,0.167,0.136],[0.317,0.282,0.719],[-0.141,0.016,-0.569],[0.516,0.371,0.488],[-0.047,0.316,0.294],[-0.061,0.048,0.755],[-0.141,0.016,0.590],[-0.411,-0.115,-0.310],[0.649,-0.111,-0.472],[0.573,-0.009,-0.537],[-0.311,-0.202,0.257],[-0.090,-0.187,-0.306],[0.167,-0.054,0.115],[0.075,-0.356,-0.187],[-0.365,0.070,-0.010],[0.561,-0.323,0.029],[-0.679,0.453,0.353],[-0.752,0.316,0.370],[-0.068,0.519,0.377],[-0.072,0.521,0.447],[0.073,0.284,0.327],[0.455,0.061,0.383],[0.431,0.069,0.304],[0.139,-0.063,-0.361],[0.450,-0.425,0.566],[0.184,-0.332,-0.105],[0.362,-0.175,0.175],[0.480,-0.138,0.060],[-0.108,-0.416,-0.085],[-0.023,-0.363,-0.362],[0.229,0.628,-0.177],[0.095,0.686,-0.174],[0.304,-0.634,-0.105],[0.558,0.082,0.293],[-0.329,0.009,0.418],[0.019,0.128,-0.653],[-0.082,0.153,0.109],[0.330,0.123,-0.709],[-0.324,-0.200,0.348],[-0.919,-0.093,0.146],[0.138,0.090,0.723],[0.105,0.071,-0.446],[0.028,0.279,-0.168],[-0.744,-0.256,-0.070],[-0.457,0.073,0.261],[0.577,0.509,0.041],[0.581,0.461,0.041],[-0.118,-0.274,-0.145],[0.104,-0.354,0.447],[0.115,0.086,-0.570],[-0.385,-0.259,0.145],[0.321,-0.126,-0.334],[0.096,-0.227,-0.391],[0.316,-0.108,-0.276],[0.020,0.181,0.377],[0.119,0.167,-0.115],[0.709,0.290,0.208],[0.027,0.544,0.456],[-0.174,0.135,0.702],[0.016,-0.102,0.022],[0.851,-0.308,-0.045],[-0.156,0.368,0.522],[0.177,0.402,0.638],[0.315,-0.238,0.315],[0.765,0.249,-0.221],[0.903,-0.267,0.153],[-0.346,-0.241,-0.620],[0.244,-0.439,0.588],[0.437,-0.512,0.557],[-0.325,0.304,-0.491],[-0.335,0.237,-0.166],[-0.453,-0.033,-0.148],[0.790,0.105,-0.256],[-0.445,0.232,0.256],[-0.273,0.300,0.255],[-0.485,0.149,0.335],[-0.552,0.355,0.059],[-0.180,-0.189,0.386],[-0.476,0.012,-0.572],[-0.552,0.355,-0.038],[-0.172,-0.039,-0.690],[0.459,-0.425,-0.595],[-0.108,-0.067,-0.004],[0.744,-0.106,-0.378],[0.695,0.132,0.499],[0.115,0.086,0.591],[0.425,-0.624,-0.177],[-0.453,0.221,0.179],[0.186,-0.129,-0.308],[0.618,-0.551,0.076],[0.561,-0.623,0.117],[0.556,-0.473,0.025],[0.369,0.211,0.650],[-0.290,0.535,0.355],[-0.693,0.017,-0.502],[-0.305,0.058,-0.027],[0.220,-0.015,0.429],[0.064,-0.123,0.710],[-0.912,-0.036,-0.346],[-0.799,0.313,0.355],[-0.285,0.001,-0.451],[-0.254,0.503,-0.050],[0.766,0.100,-0.375],[-0.685,0.185,0.011],[0.391,0.365,0.555],[0.395,0.450,0.538],[0.274,0.477,0.563],[0.340,-0.144,-0.698],[-0.275,-0.332,0.161],[0.369,0.211,-0.629],[0.345,-0.030,-0.331],[0.721,0.039,0.428],[-0.003,0.324,-0.651],[-0.138,0.210,-0.671],[0.134,0.008,0.778],[0.007,-0.020,0.768],[0.352,-0.156,0.082],[0.433,-0.204,0.061],[0.097,-0.562,0.408],[-0.205,-0.334,0.024],[-0.246,-0.344,0.108],[-0.582,-0.203,-0.382],[-0.582,0.099,0.044],[0.383,0.384,0.636],[0.063,-0.338,-0.654],[0.102,-0.268,-0.620],[0.226,-0.342,-0.628],[-0.035,-0.309,0.158],[0.049,-0.263,0.151],[-0.610,0.223,-0.046],[0.291,0.604,-0.286],[0.352,0.620,-0.164],[-0.680,-0.107,0.382],[-0.667,-0.093,0.290],[0.394,-0.314,-0.356],[-0.099,-0.140,-0.029],[0.345,-0.030,0.352],[-0.912,-0.036,0.367],[-0.677,0.525,-0.198],[-0.580,-0.253,-0.454],[-0.281,0.628,0.245],[0.225,0.577,-0.413],[0.121,-0.136,0.250],[-0.061,0.273,-0.201],[0.726,-0.304,0.434],[-0.644,-0.156,0.175],[-0.298,-0.177,-0.172],[0.101,-0.252,-0.670],[-0.118,-0.274,0.166],[0.253,-0.809,-0.125],[-0.457,-0.150,-0.602],[-0.904,-0.131,0.058],[0.186,-0.129,0.329],[0.858,-0.178,-0.247],[-0.699,-0.090,-0.501],[0.452,-0.378,0.454],[0.397,-0.072,0.105],[-0.577,0.097,-0.246],[-0.595,0.604,0.164],[-0.829,-0.149,0.166],[0.749,0.199,-0.311],[0.305,0.099,-0.217],[0.389,-0.018,-0.253],[0.186,0.070,-0.172],[-0.825,0.074,-0.370],[-0.856,-0.008,-0.398],[-0.039,-0.311,-0.662],[-0.357,0.099,0.640],[-0.373,0.048,0.589],[-0.345,-0.202,-0.419],[0.598,-0.303,-0.524],[-0.110,-0.315,-0.580],[-0.883,-0.072,-0.034],[0.398,0.099,0.033],[-0.086,0.031,0.448],[-0.895,0.326,-0.093],[-0.518,-0.183,0.033],[0.345,0.308,-0.612],[-0.283,0.102,0.336],[-0.448,-0.398,0.489],[0.184,0.205,-0.336],[0.293,-0.869,-0.109],[0.259,0.114,0.289],[-0.248,0.506,0.388],[-0.485,0.149,-0.314],[0.863,0.121,-0.090],[-0.242,-0.163,-0.007],[0.258,0.534,0.460],[0.913,-0.182,-0.046],[0.462,0.003,-0.306],[0.431,0.069,-0.283],[0.558,0.082,-0.272],[-0.500,0.129,0.617],[0.267,-0.308,-0.316],[-0.157,0.291,0.232],[0.692,0.198,0.395],[-0.563,-0.238,0.133],[-0.053,-0.321,-0.304],[-0.500,0.129,-0.596],[-0.786,0.136,-0.041],[0.045,-0.401,-0.234],[0.383,0.384,-0.615],[-0.718,0.534,-0.139],[-0.962,-0.024,0.161],[-0.886,-0.102,0.228],[-0.667,-0.093,-0.270],[-0.257,-0.166,0.266],[0.145,-0.112,0.689],[-0.133,0.509,-0.444],[-0.402,0.232,-0.232],[0.186,0.070,0.193],[0.903,-0.267,-0.132],[0.658,-0.231,0.520],[-0.584,0.165,0.524],[0.578,-0.210,-0.565],[0.498,-0.279,-0.252],[-0.577,0.097,0.267],[0.658,-0.231,-0.499],[0.315,-0.672,0.201],[-0.531,-0.379,0.366],[-0.572,-0.307,0.300],[-0.194,-0.176,-0.222],[-0.282,0.083,0.683],[0.670,-0.532,0.133],[0.598,-0.551,0.378],[0.627,-0.595,0.225],[0.363,-0.205,0.270],[-0.395,0.397,-0.494],[0.459,-0.053,0.050],[-0.020,-0.263,-0.036],[0.088,-0.418,0.396],[0.306,-0.558,-0.609],[-0.903,0.298,0.243],[-0.610,0.223,0.067],[0.268,0.571,-0.019],[0.268,0.571,0.041],[0.780,-0.239,-0.361],[-0.018,-0.006,-0.442],[0.096,0.498,-0.403]]

interface WorkerNode {
  id: string
  folder: string
  tags?: string[]
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  [key: string]: unknown
}

interface WorkerLink {
  source: string | WorkerNode
  target: string | WorkerNode
}

type WorkerSimulation = ReturnType<typeof forceSimulation>

let simulation: WorkerSimulation | null = null
let simNodes: WorkerNode[] = []
let tierMap = new Map<string, 'regular' | 'supernode' | 'ultranode'>()
// Module-scope adjacency + id→node lookup (populated per init), used by the
// localized drag relax in the pin/move handlers.
let workerAdjacency = new Map<string, string[]>()
let nodeByIdMap = new Map<string, WorkerNode>()
let nodeIndexMap = new Map<string, number>() // id → index into simNodes (= position-array index)
// Localized drag state: the neighbourhood that springs along with the grabbed
// node, plus the link constraints (PBD) solved during the drag. Empty when idle.
let dragMovableSet = new Set<string>()
let dragLinks: Array<{ a: WorkerNode; b: WorkerNode; rest: number; aMove: boolean; bMove: boolean }> = []
let dragNodes: WorkerNode[] = [] // movable + dragged node objects, for the collision pass
let tickCount = 0
let tickRunning = false
let initGeneration = 0 // bumped per init; stale precalc chunk loops abort when it moves
let stableFrameCount = 0  // consecutive frames with mean delta < 0.5 (natural layout early-exit)
const MAX_TICKS = 200   // 300→200: practical convergence happens well before 300 ticks
const ALPHA_MIN = 0.001 // early-exit threshold
let graphShape: GraphShape = 'natural'
// Imported-shape targets (ported swarm position functions, see src/shapes/).
// Rebuilt by init and on setGraphShape switches; keyed by node id like the
// built-in target maps. importedTargetsShape tracks which shape they're for.
let importedTargets = new Map<string, { x: number; y: number; z: number }>()
let importedTargetsShape: string | null = null
let rebuildImportedTargets: ((shape: string) => void) | null = null
// Live particle motion (casberry `time`-driven formations): the active def and
// its node ordering are kept so runTick can re-evaluate targets each tick.
let importedDefActive: import('../shapes/types').ImportedShapeDef | null = null
let importedOrdered: { id: string }[] | null = null
let shapeMotion = true
let shapeTime = 0
const motionRng = () => 0.5 // animated formations derive randomness from i, not rng

function shapeMotionActive(): boolean {
  return shapeMotion && graphShape.startsWith('imported:') && !!importedDefActive?.animated && !!importedOrdered
}

function advanceShapeMotion() {
  if (!importedDefActive || !importedOrdered) return
  shapeTime += 1 / 60
  const count = importedOrdered.length
  for (let i = 0; i < count; i++) {
    const t = importedDefActive.position(i, count, motionRng, shapeTime)
    const cur = importedTargets.get(importedOrdered[i].id)
    if (cur) {
      cur.x = t.x
      cur.y = t.y
      cur.z = t.z
    } else {
      importedTargets.set(importedOrdered[i].id, t)
    }
  }
}
let currentSpread = 2.0
// Spread the current natural-layout positions represent. Spread-adjust scales all
// coordinates by (newSpread / naturalDisplaySpread) around the centre of gravity —
// pure geometric zoom of the precalc'd layout, no re-simulation. Set when a fresh
// natural layout is computed; preserved across data updates and drags.
let naturalDisplaySpread = 1.0
interface TagBoxEntry {
  tag: string; cx: number; cy: number; cz: number; count: number; halfSize: number
  halfSizeX?: number; halfSizeY?: number; halfSizeZ?: number
  isVirtual?: boolean; parentTags?: [string, string]
}
interface TagBoxTarget {
  x: number; y: number; z: number; tag: string; matchedCount: number
  assignedBox?: { cx: number; cy: number; cz: number; halfSizeX: number; halfSizeY: number; halfSizeZ: number }
}
let tagBoxesList: TagBoxEntry[] = []
// Trees shape branch skeleton (trunk + branch line segments, world space) —
// rebuilt per init, posted to the main thread for LineSegments rendering
export interface TreeBranchSegment { ax: number; ay: number; az: number; bx: number; by: number; bz: number }
let treeBranchesList: TreeBranchSegment[] = []
let treesTargets = new Map<string, { x: number; y: number; z: number }>()
// Trees spread support: geometry is authored once in per-tree local coords
// (base point + local offset) so the spread slider can rescale every tree about
// its own base on the plane — taller from the same base, branches and leaves
// proportionally wider. Ground-scatter notes are static (they ARE the plane).
interface TreeLocalTarget { bx: number; bz: number; lx: number; ly: number; lz: number }
interface TreeLocalBranch { bx: number; bz: number; lax: number; lay: number; laz: number; lbx: number; lby: number; lbz: number }
export interface TreeLabelInfo { text: string; x: number; y: number; z: number }
let treesStaticTargets = new Map<string, { x: number; y: number; z: number }>()
let treesLocalTargets = new Map<string, TreeLocalTarget>()
let treesLocalBranches: TreeLocalBranch[] = []
// Folder-name label at each tree base (does not scale with spread — bases are fixed)
let treeLabelsList: TreeLabelInfo[] = []
const TREES_NEUTRAL_SPREAD = 2 // slider value at which trees render at authored size
function applyTreesSpread(spread: number): void {
  const s = Math.max(0.25, spread / TREES_NEUTRAL_SPREAD)
  treesTargets = new Map(treesStaticTargets)
  for (const [id, t] of treesLocalTargets) {
    treesTargets.set(id, { x: t.bx + t.lx * s, y: t.ly * s, z: t.bz + t.lz * s })
  }
  treeBranchesList = treesLocalBranches.map(b => ({
    ax: b.bx + b.lax * s, ay: b.lay * s, az: b.bz + b.laz * s,
    bx: b.bx + b.lbx * s, by: b.lby * s, bz: b.bz + b.lbz * s,
  }))
}
let tagBoxTargets = new Map<string, TagBoxTarget>()

// Tag box world-space constants
const TAG_BOX_COLS = 6
const TAG_BOX_GAP = 650
const BASE_HALF = 80
const SCALE_HALF = 15
const MAX_HALF = 300
const MIN_SHARED = 3
const MIN_GAP = 40
const SPRING_ITERATIONS = 80
const SPRING_ATTRACTION_K = 0.15
const SPRING_REPULSION_K = 0.08
let tagBoxTopN = 24
let tagBoxSizeScale = 1.0

function computeHalfSize(nodeCount: number): number {
  return Math.min(MAX_HALF * tagBoxSizeScale, (BASE_HALF + SCALE_HALF * Math.sqrt(nodeCount)) * tagBoxSizeScale)
}

function buildTagBoxTargets(topN: number) {
  tagBoxTopN = topN
  tagBoxTargets = new Map()
  tagBoxesList = []
  if (simNodes.length === 0) return

  const tagBoxRows = Math.ceil(topN / TAG_BOX_COLS)

  // Count tags
  const tagCountMap = new Map<string, number>()
  for (const node of simNodes) {
    for (const tag of (node.tags ?? [])) tagCountMap.set(tag, (tagCountMap.get(tag) ?? 0) + 1)
  }
  const MIN_TAG_COUNT = 5
  const topTags = [...tagCountMap.entries()]
    .filter(([, count]) => count >= MIN_TAG_COUNT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag]) => tag)

  if (topTags.length === 0) return

  const topTagSet = new Set(topTags)

  // Phase 1: Variable half sizes per tag
  const halfSizeMap = new Map<string, number>()
  for (const tag of topTags) {
    halfSizeMap.set(tag, computeHalfSize(tagCountMap.get(tag) ?? 0))
  }

  // Initial grid positions (x/y plane, z=0)
  const tagBoxCenters = new Map<string, { x: number; y: number; z: number }>()
  topTags.forEach((tag, i) => {
    const col = i % TAG_BOX_COLS
    const row = Math.floor(i / TAG_BOX_COLS)
    tagBoxCenters.set(tag, {
      x: (col - (TAG_BOX_COLS - 1) / 2) * TAG_BOX_GAP,
      y: (row - (tagBoxRows - 1) / 2) * TAG_BOX_GAP,
      z: 0,
    })
  })

  // Compute shared node counts between tag pairs
  const sharedMap = new Map<string, number>()
  for (const node of simNodes) {
    const nodeTags = (node.tags ?? []).filter(t => topTagSet.has(t))
    for (let i = 0; i < nodeTags.length; i++) {
      for (let j = i + 1; j < nodeTags.length; j++) {
        const pair = [nodeTags[i], nodeTags[j]].sort()
        const key = `${pair[0]}|${pair[1]}`
        sharedMap.set(key, (sharedMap.get(key) ?? 0) + 1)
      }
    }
  }

  // Phase 2: Spring layout — settle box positions in X/Y plane
  const posArr = topTags.map(tag => ({ tag, x: tagBoxCenters.get(tag)!.x, y: tagBoxCenters.get(tag)!.y }))
  for (let iter = 0; iter < SPRING_ITERATIONS; iter++) {
    const forces = posArr.map(() => ({ fx: 0, fy: 0 }))
    for (let i = 0; i < posArr.length; i++) {
      for (let j = i + 1; j < posArr.length; j++) {
        const a = posArr[i], b = posArr[j]
        const hs_A = halfSizeMap.get(a.tag)!
        const hs_B = halfSizeMap.get(b.tag)!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const nx = dx / dist, ny = dy / dist
        const pair = [a.tag, b.tag].sort()
        const shared = sharedMap.get(`${pair[0]}|${pair[1]}`) ?? 0
        if (shared >= MIN_SHARED) {
          const overlapHalfSize = Math.min(computeHalfSize(shared), Math.min(hs_A, hs_B) * 0.8)
          const requiredDist = hs_A + hs_B - 2 * overlapHalfSize
          const diff = dist - requiredDist
          const f = diff * SPRING_ATTRACTION_K
          forces[i].fx += nx * f; forces[i].fy += ny * f
          forces[j].fx -= nx * f; forces[j].fy -= ny * f
        }
        const minDist = hs_A + hs_B + MIN_GAP
        if (dist < minDist) {
          const f = (minDist - dist) * SPRING_REPULSION_K
          forces[i].fx -= nx * f; forces[i].fy -= ny * f
          forces[j].fx += nx * f; forces[j].fy += ny * f
        }
      }
    }
    for (let i = 0; i < posArr.length; i++) {
      posArr[i].x += forces[i].fx
      posArr[i].y += forces[i].fy
    }
  }
  for (const p of posArr) {
    tagBoxCenters.set(p.tag, { x: p.x, y: p.y, z: 0 })
  }

  // Phase 3: Virtual overlap boxes (A∩B)
  const virtualBoxes: TagBoxEntry[] = []
  const virtualBoxMap = new Map<string, TagBoxEntry>()
  for (let i = 0; i < topTags.length; i++) {
    for (let j = i + 1; j < topTags.length; j++) {
      const tagA = topTags[i], tagB = topTags[j]
      const pair = [tagA, tagB].sort()
      const shared = sharedMap.get(`${pair[0]}|${pair[1]}`) ?? 0
      if (shared < MIN_SHARED) continue
      const cA = tagBoxCenters.get(tagA)!
      const cB = tagBoxCenters.get(tagB)!
      const hs_A = halfSizeMap.get(tagA)!
      const hs_B = halfSizeMap.get(tagB)!
      const overlapMinX = Math.max(cA.x - hs_A, cB.x - hs_B)
      const overlapMaxX = Math.min(cA.x + hs_A, cB.x + hs_B)
      const overlapMinY = Math.max(cA.y - hs_A, cB.y - hs_B)
      const overlapMaxY = Math.min(cA.y + hs_A, cB.y + hs_B)
      if (overlapMaxX > overlapMinX + 10 && overlapMaxY > overlapMinY + 10) {
        const halfSizeZ = Math.min(hs_A, hs_B) * 0.5
        const vb: TagBoxEntry = {
          tag: `${tagA}∩${tagB}`,
          cx: (overlapMinX + overlapMaxX) / 2,
          cy: (overlapMinY + overlapMaxY) / 2,
          cz: 0,
          halfSizeX: (overlapMaxX - overlapMinX) / 2,
          halfSizeY: (overlapMaxY - overlapMinY) / 2,
          halfSizeZ,
          count: shared,
          isVirtual: true,
          parentTags: [tagA, tagB],
          halfSize: Math.min((overlapMaxX - overlapMinX) / 2, (overlapMaxY - overlapMinY) / 2),
        }
        virtualBoxes.push(vb)
        virtualBoxMap.set(`${pair[0]}|${pair[1]}`, vb)
      }
    }
  }

  // Orphan height: above the highest box
  const maxBoxY = posArr.length > 0 ? Math.max(...posArr.map(p => p.y + (halfSizeMap.get(p.tag) ?? BASE_HALF))) : 0
  const orphanY = maxBoxY + TAG_BOX_GAP * 0.5

  // Phase 4: Deterministic node placement
  for (const node of simNodes) {
    const matchedTags = (node.tags ?? []).filter(t => topTagSet.has(t))
    const matchedCount = matchedTags.length

    if (matchedCount === 0) {
      // Orphan cloud — spread in a wide 3D zone above the grid, not a thin line.
      // assignedBox must be large enough to prevent AABB containment from squashing them.
      const orphanSpread = TAG_BOX_GAP * 0.5
      tagBoxTargets.set(node.id, {
        x: (Math.random() - 0.5) * TAG_BOX_COLS * TAG_BOX_GAP,
        y: orphanY + (Math.random() - 0.5) * orphanSpread,
        z: (Math.random() - 0.5) * orphanSpread,
        tag: '', matchedCount: 0,
        assignedBox: { cx: 0, cy: orphanY, cz: 0, halfSizeX: TAG_BOX_COLS * TAG_BOX_GAP / 2, halfSizeY: orphanSpread, halfSizeZ: orphanSpread },
      })
    } else if (matchedCount === 1) {
      const tag = matchedTags[0]
      const center = tagBoxCenters.get(tag)!
      const hs = halfSizeMap.get(tag)!
      tagBoxTargets.set(node.id, {
        x: center.x + (Math.random() - 0.5) * hs * 1.6,
        y: center.y + (Math.random() - 0.5) * hs * 1.6,
        z: (Math.random() - 0.5) * hs * 0.8,
        tag, matchedCount: 1,
        assignedBox: { cx: center.x, cy: center.y, cz: 0, halfSizeX: hs, halfSizeY: hs, halfSizeZ: hs },
      })
    } else if (matchedCount === 2) {
      const pair = [...matchedTags].sort()
      const vb = virtualBoxMap.get(`${pair[0]}|${pair[1]}`)
      if (vb) {
        const hx = vb.halfSizeX ?? vb.halfSize ?? 80
        const hy = vb.halfSizeY ?? vb.halfSize ?? 80
        const hz = vb.halfSizeZ ?? 40
        tagBoxTargets.set(node.id, {
          x: vb.cx + (Math.random() - 0.5) * hx * 1.6,
          y: vb.cy + (Math.random() - 0.5) * hy * 1.6,
          z: (Math.random() - 0.5) * hz * 1.6,
          tag: vb.tag, matchedCount: 2,
          assignedBox: { cx: vb.cx, cy: vb.cy, cz: 0, halfSizeX: hx, halfSizeY: hy, halfSizeZ: hz },
        })
      } else {
        const tag = (tagCountMap.get(matchedTags[0]) ?? 0) <= (tagCountMap.get(matchedTags[1]) ?? 0) ? matchedTags[0] : matchedTags[1]
        const center = tagBoxCenters.get(tag)!
        const hs = halfSizeMap.get(tag)!
        tagBoxTargets.set(node.id, {
          x: center.x + (Math.random() - 0.5) * hs * 1.6,
          y: center.y + (Math.random() - 0.5) * hs * 1.6,
          z: (Math.random() - 0.5) * hs * 0.8,
          tag, matchedCount: 1,
          assignedBox: { cx: center.x, cy: center.y, cz: 0, halfSizeX: hs, halfSizeY: hs, halfSizeZ: hs },
        })
      }
    } else {
      // 3+ matched tags: compute n-way AABB intersection
      const matchedBoxes = matchedTags.map(t => ({
        cx: tagBoxCenters.get(t)!.x, cy: tagBoxCenters.get(t)!.y, hs: halfSizeMap.get(t)!,
      }))
      const minX = Math.max(...matchedBoxes.map(b => b.cx - b.hs))
      const maxX = Math.min(...matchedBoxes.map(b => b.cx + b.hs))
      const minY = Math.max(...matchedBoxes.map(b => b.cy - b.hs))
      const maxY = Math.min(...matchedBoxes.map(b => b.cy + b.hs))
      const hsZ = Math.min(...matchedBoxes.map(b => b.hs)) * 0.5
      if (maxX > minX + 10 && maxY > minY + 10) {
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
        const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2
        tagBoxTargets.set(node.id, {
          x: cx + (Math.random() - 0.5) * hx * 1.6,
          y: cy + (Math.random() - 0.5) * hy * 1.6,
          z: (Math.random() - 0.5) * hsZ * 1.6,
          tag: matchedTags[0], matchedCount,
          assignedBox: { cx, cy, cz: 0, halfSizeX: hx, halfSizeY: hy, halfSizeZ: hsZ },
        })
      } else {
        // Fallback: find largest 2-way virtual box among matched pairs
        let bestVb: TagBoxEntry | undefined, bestArea = 0
        for (let i = 0; i < matchedTags.length; i++) {
          for (let j = i + 1; j < matchedTags.length; j++) {
            const p = [...[matchedTags[i], matchedTags[j]]].sort()
            const vb = virtualBoxMap.get(`${p[0]}|${p[1]}`)
            if (vb) {
              const area = (vb.halfSizeX ?? vb.halfSize ?? 0) * (vb.halfSizeY ?? vb.halfSize ?? 0)
              if (area > bestArea) { bestArea = area; bestVb = vb }
            }
          }
        }
        if (bestVb) {
          const hx = bestVb.halfSizeX ?? bestVb.halfSize ?? 80
          const hy = bestVb.halfSizeY ?? bestVb.halfSize ?? 80
          const hz = bestVb.halfSizeZ ?? 40
          tagBoxTargets.set(node.id, {
            x: bestVb.cx + (Math.random() - 0.5) * hx * 1.6,
            y: bestVb.cy + (Math.random() - 0.5) * hy * 1.6,
            z: (Math.random() - 0.5) * hz * 1.6,
            tag: bestVb.tag, matchedCount,
            assignedBox: { cx: bestVb.cx, cy: bestVb.cy, cz: 0, halfSizeX: hx, halfSizeY: hy, halfSizeZ: hz },
          })
        } else {
          const tag = matchedTags[0]
          const center = tagBoxCenters.get(tag)!
          const hs = halfSizeMap.get(tag)!
          tagBoxTargets.set(node.id, {
            x: center.x + (Math.random() - 0.5) * hs * 1.6,
            y: center.y + (Math.random() - 0.5) * hs * 1.6,
            z: (Math.random() - 0.5) * hs * 0.8,
            tag, matchedCount: 1,
            assignedBox: { cx: center.x, cy: center.y, cz: 0, halfSizeX: hs, halfSizeY: hs, halfSizeZ: hs },
          })
        }
      }
    }
  }

  // ── Backfill empty parent boxes ──────────────────────────────────────────
  // If a real tag box has 0 nodes assigned (all its nodes got routed to virtual
  // intersection boxes), reassign some of them back to the parent box.
  // This ensures every visible box has at least some nodes inside it.
  const MIN_NODES_PER_BOX = 3

  const nodesPerRealBox = new Map<string, string[]>()
  for (const tag of topTags) nodesPerRealBox.set(tag, [])
  for (const [nodeId, target] of tagBoxTargets) {
    if (nodesPerRealBox.has(target.tag)) {
      nodesPerRealBox.get(target.tag)!.push(nodeId)
    }
  }

  for (const realTag of topTags) {
    const count = nodesPerRealBox.get(realTag)!.length
    if (count >= MIN_NODES_PER_BOX) continue  // already populated

    // Find nodes currently in virtual boxes that include this tag
    const candidates: string[] = []
    for (const [nodeId, target] of tagBoxTargets) {
      if (target.matchedCount >= 2 && typeof target.tag === 'string' && target.tag.includes('∩')) {
        const vTag = target.tag
        if (vTag.startsWith(realTag + '∩') || vTag.endsWith('∩' + realTag)) {
          candidates.push(nodeId)
        }
      }
    }

    // Reassign up to MIN_NODES_PER_BOX worth of candidates to the real box
    const needed = MIN_NODES_PER_BOX - count
    const toMove = candidates.slice(0, needed)
    const center = tagBoxCenters.get(realTag)!
    const hs = halfSizeMap.get(realTag)!
    for (const nodeId of toMove) {
      tagBoxTargets.set(nodeId, {
        x: center.x + (Math.random() - 0.5) * hs * 1.6,
        y: center.y + (Math.random() - 0.5) * hs * 1.6,
        z: (Math.random() - 0.5) * hs * 0.8,
        tag: realTag, matchedCount: 1,
        assignedBox: { cx: center.x, cy: center.y, cz: 0, halfSizeX: hs, halfSizeY: hs, halfSizeZ: hs },
      })
    }
  }

  // Build tagBoxesList: real boxes + virtual boxes
  tagBoxesList = [
    ...topTags.map(tag => {
      const center = tagBoxCenters.get(tag)!
      const hs = halfSizeMap.get(tag)!
      return { tag, cx: center.x, cy: center.y, cz: center.z, count: tagCountMap.get(tag) ?? 0, halfSize: hs }
    }),
    ...virtualBoxes,
  ]
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let sunOuterRadius = 300  // set during init, used by shape force
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let sunInnerRadius = 54   // set during init

// P1: binary position protocol — pack xyz triplets into a Float32Array and post it
// with a transfer list (zero-copy handoff). Node order + tiers are announced once per
// init via the 'nodeOrder' message; every position update is aligned to that order.
// This replaces per-tick structured cloning of N {id,x,y,z,tier} objects, which
// caused GC hitches on both threads while the natural-pattern sim streamed.
const post = self.postMessage.bind(self) as unknown as (message: unknown, transfer?: Transferable[]) => void

// Module-scope tier→base-charge (mirrors the init-local naturalChargeStrength);
// used by setSpread to keep the interactive sim's charge consistent after a zoom.
function naturalChargeStrengthBase(d: unknown): number {
  const node = d as WorkerNode
  const tier = tierMap.get(node.id) ?? 'regular'
  return tier === 'ultranode' ? -350 : tier === 'supernode' ? -200 : -120
}

function packPositions(): Float32Array {
  const arr = new Float32Array(simNodes.length * 3)
  for (let i = 0; i < simNodes.length; i++) {
    const n = simNodes[i]
    // Sanitize at this single serialization chokepoint (used by BOTH the per-tick
    // stream and the final 'end' frame): a single non-finite coord poisons the
    // render's Box3 bounding-sphere → NaN camera position → silent black screen
    // (Box3/Sphere NaN, unlike computeBoundingSphere, logs no warning). Imported
    // formulas (black-hole formations) and coincident-seed force blowups can both
    // emit NaN; `?? 0` only caught undefined, not NaN/Infinity.
    arr[i * 3] = Number.isFinite(n.x) ? (n.x as number) : 0
    arr[i * 3 + 1] = Number.isFinite(n.y) ? (n.y as number) : 0
    arr[i * 3 + 2] = Number.isFinite(n.z) ? (n.z as number) : 0
  }
  return arr
}

// ── Localized drag relax (PBD) ───────────────────────────────────────────────
// When a natural node is dragged, only its 1–2 hop neighbourhood springs along;
// every other node is a fixed anchor, so the global shape never collapses. The
// grabbed node is pinned to the cursor; its neighbours satisfy link-length
// constraints (rest = length at grab time) via a few position-based-dynamics
// iterations — cheap (bounded set) and stable.
const DRAG_MAX_MOVABLE = 250
const DRAG_HOPS = 2
const DRAG_STIFFNESS = 0.5
const DRAG_ITERS = 6

// Tier-aware minimum node separation (collide radius). Larger for hubs so
// supernodes/ultranodes keep clearance. Used by forceCollide AND the drag PBD,
// so min-distance holds during dragging too. Mutable — the UI adjusts these via
// the 'setMinDist' message; tierRadius() and the drag PBD read them live.
let MIN_DIST_REGULAR = 12
let MIN_DIST_SUPER = 35
let MIN_DIST_ULTRA = 70
function tierRadius(id: string): number {
  // Trees: min-distance disabled — leaf/junction placement is authored geometry
  // and per-tier radii would blow the tight tip clusters apart (e.g. drag PBD)
  if (graphShape === 'trees') return 1
  const t = tierMap.get(id)
  return t === 'ultranode' ? MIN_DIST_ULTRA : t === 'supernode' ? MIN_DIST_SUPER : MIN_DIST_REGULAR
}

// Cheap collide-ONLY relax with the current per-tier radii (no charge/link, so the
// natural layout is preserved — just re-spaced). Mirrors the Spread pattern: compute
// once and post a single frame; Graph3D's LERP glide animates it smoothly. Used to
// apply min-distance changes (slider) and to bake the defaults into the initial layout.
function collideRelaxTier(ticks: number, emit: boolean): void {
  if (simNodes.length === 0) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sim = forceSimulation(simNodes as any, 3)
    .force('collide', forceCollide().radius((d: { id: string }) => tierRadius(d.id)))
    .velocityDecay(0.6)
    .alpha(0.5)
    .stop()
  for (let i = 0; i < ticks; i++) sim.tick()
  for (const n of simNodes) { n.vx = 0; n.vy = 0; (n as WorkerNode & { vz?: number }).vz = 0 }
  if (emit) {
    const positions = packPositions()
    post({ type: 'end', positions, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer])
  }
}

// ── Min-distance as a pure transform of the BASE layout (the Spread model) ──
// basePositions = the canonical natural layout WITHOUT any min-distance collide baked
// in (3N, aligned to simNodes order, at naturalDisplaySpread scale). applyMinDist()
// always restores these coordinates and re-runs the per-tier collide polish on top, so
// the sliders are reversible (lowering contracts back toward the natural layout) and
// idempotent. The base is what the layout cache persists; it is rescaled by setSpread
// and patched at drag end so user placements survive a re-polish.
let basePositions: Float32Array | null = null
const MINDIST_POLISH_ITERS = 6

function captureBase(): void {
  basePositions = packPositions()
}

// Per-tier min-distance collide polish over the FULL node set — Rust run_polish_tiered
// (each node carries its own tier radius) with a d3 collide fallback. No charge/link,
// so clusters don't move; the layout is just re-spaced.
function polishTieredFullSet(wasm: ForceWasm | null, iters: number): void {
  const n = simNodes.length
  if (n === 0) return
  if (wasm && typeof wasm.run_polish_tiered === 'function') {
    const posPtr = wasm.alloc(n * 3 * 4)
    const radiiPtr = wasm.alloc(n * 4)
    const pv = new Float32Array(wasm.memory.buffer, posPtr, n * 3)
    const rv = new Float32Array(wasm.memory.buffer, radiiPtr, n)
    for (let i = 0; i < n; i++) {
      pv[i * 3] = simNodes[i].x ?? 0
      pv[i * 3 + 1] = simNodes[i].y ?? 0
      pv[i * 3 + 2] = (simNodes[i] as WorkerNode & { z?: number }).z ?? 0
      rv[i] = tierRadius(simNodes[i].id)
    }
    wasm.run_polish_tiered(n, posPtr, radiiPtr, 0.6, iters)
    const out = new Float32Array(wasm.memory.buffer, posPtr, n * 3) // re-view: memory may have grown
    for (let i = 0; i < n; i++) {
      simNodes[i].x = out[i * 3]
      simNodes[i].y = out[i * 3 + 1]
      ;(simNodes[i] as WorkerNode & { z?: number }).z = out[i * 3 + 2]
    }
    wasm.dealloc(posPtr, n * 3 * 4)
    wasm.dealloc(radiiPtr, n * 4)
  } else {
    collideRelaxTier(iters, false)
  }
}

// Apply the current MIN_DIST_* to the natural layout: restore the base coordinates,
// run the per-tier collide polish (wasm, ~60-100ms for ~10.5k nodes), zero velocities
// and post ONE 'end' frame — Graph3D's LERP glide animates it, exactly like Spread.
// No interactive-sim ticks (the old path re-ticked the full sim for ~2s, and d3's
// forceCollide caches per-node radii at initialize() so the new values never even
// reached it). Async only on the (cached) wasm load; safe to call back-to-back.
function applyMinDist(emit: boolean): void {
  if (graphShape !== 'natural' || simNodes.length === 0) return
  if (tickRunning) return // precalc in flight — finishPrecalc bakes the current values
  if (dragMovableSet.size > 0) return // mid-drag: the drag PBD reads the new radii live
  const gen = initGeneration
  loadForceWasm().then(wasm => {
    if (gen !== initGeneration) return
    if (tickRunning || dragMovableSet.size > 0) return // state moved while wasm loaded
    const t0 = performance.now()
    if (basePositions && basePositions.length === simNodes.length * 3) {
      for (let i = 0; i < simNodes.length; i++) {
        const n = simNodes[i]
        n.x = basePositions[i * 3]
        n.y = basePositions[i * 3 + 1]
        ;(n as WorkerNode & { z?: number }).z = basePositions[i * 3 + 2]
      }
    } else {
      captureBase() // defensive: no base yet — current positions become the base
    }
    polishTieredFullSet(wasm, MINDIST_POLISH_ITERS)
    for (const n of simNodes) {
      // Pinned (user-dropped) nodes stay exactly where they were left.
      if (typeof n.fx === 'number') n.x = n.fx
      if (typeof n.fy === 'number') n.y = n.fy
      if (typeof n.fz === 'number') (n as WorkerNode & { z?: number }).z = n.fz
      n.vx = 0; n.vy = 0; (n as WorkerNode & { vz?: number }).vz = 0
    }
    simulation?.alpha(0)
    if (emit) {
      const positions = packPositions()
      post({ type: 'end', positions, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer])
    }
    console.log(`[mindist] applied r=${MIN_DIST_REGULAR}/s=${MIN_DIST_SUPER}/u=${MIN_DIST_ULTRA} engine=${wasm ? 'wasm' : 'd3'} compute=${(performance.now() - t0).toFixed(1)}ms n=${simNodes.length}`)
  })
}

function buildDragNeighborhood(draggedIds: string[]): void {
  const dragged = new Set(draggedIds)
  dragMovableSet = new Set()
  let frontier = [...dragged]
  for (let h = 0; h < DRAG_HOPS && dragMovableSet.size < DRAG_MAX_MOVABLE; h++) {
    const next: string[] = []
    for (const id of frontier) {
      const neigh = workerAdjacency.get(id)
      if (!neigh) continue
      for (const m of neigh) {
        if (dragged.has(m) || dragMovableSet.has(m)) continue
        dragMovableSet.add(m); next.push(m)
        if (dragMovableSet.size >= DRAG_MAX_MOVABLE) break
      }
      if (dragMovableSet.size >= DRAG_MAX_MOVABLE) break
    }
    frontier = next
  }
  // Link constraints touching the movable set (links between two fixed anchors are
  // irrelevant). rest = current length so the neighbourhood keeps its shape.
  dragLinks = []
  const relevant = [...dragMovableSet, ...dragged]
  const seen = new Set<string>()
  for (const id of relevant) {
    for (const mId of workerAdjacency.get(id) ?? []) {
      const key = id < mId ? `${id}${mId}` : `${mId}${id}`
      if (seen.has(key)) continue
      seen.add(key)
      const aMove = dragMovableSet.has(id)
      const bMove = dragMovableSet.has(mId)
      if (!aMove && !bMove) continue
      const a = nodeByIdMap.get(id), b = nodeByIdMap.get(mId)
      if (!a || !b) continue
      const dx = a.x - b.x, dy = a.y - b.y
      const dz = ((a as WorkerNode & { z?: number }).z ?? 0) - ((b as WorkerNode & { z?: number }).z ?? 0)
      const rest = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      dragLinks.push({ a, b, rest, aMove, bMove })
    }
  }
  // Node objects in the drag set — used by the collision pass in solveDragRelax.
  dragNodes = relevant.map(id => nodeByIdMap.get(id)).filter((n): n is WorkerNode => !!n)
}

// Tier-aware collision for the drag neighbourhood — pushes overlapping nodes apart to
// their combined min-distance (hubs get more clearance). Pinned nodes (fx set) stay put.
function separateDragNodes(passes: number): void {
  const n = dragNodes.length
  if (n < 2) return
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const a = dragNodes[i]
      const ra = tierRadius(a.id)
      const aFixed = a.fx != null
      const az = (a as WorkerNode & { z?: number }).z ?? 0
      for (let j = i + 1; j < n; j++) {
        const b = dragNodes[j]
        const minD = ra + tierRadius(b.id)
        const bz = (b as WorkerNode & { z?: number }).z ?? 0
        const dx = b.x - a.x, dy = b.y - a.y, dz = bz - az
        const L2 = dx * dx + dy * dy + dz * dz
        if (L2 >= minD * minD || L2 < 1e-9) continue
        const L = Math.sqrt(L2)
        const push = (minD - L) / L
        const bFixed = b.fx != null
        const wa = aFixed ? 0 : (bFixed ? 1 : 0.5)
        const wb = bFixed ? 0 : (aFixed ? 1 : 0.5)
        if (wa) { a.x -= dx * push * wa; a.y -= dy * push * wa; (a as WorkerNode & { z?: number }).z = az - dz * push * wa }
        if (wb) { b.x += dx * push * wb; b.y += dy * push * wb; (b as WorkerNode & { z?: number }).z = bz + dz * push * wb }
      }
    }
  }
}

function solveDragRelax(iterations: number): void {
  for (let it = 0; it < iterations; it++) {
    for (const c of dragLinks) {
      const a = c.a, b = c.b
      const az = (a as WorkerNode & { z?: number }).z ?? 0
      const bz = (b as WorkerNode & { z?: number }).z ?? 0
      let dx = b.x - a.x, dy = b.y - a.y, dz = bz - az
      let L = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (L < 1e-6) { dx = 1e-3; dy = 0; dz = 0; L = 1e-3 }
      // Don't let the link spring pull two nodes closer than their combined tier
      // min-distance — otherwise a hub's link springs crush its neighbourhood into a
      // thin cone. Clamp the effective rest length up to the min-distance so the pull
      // only shortens links that are still longer than the nodes' clearance.
      const minSep = tierRadius(a.id) + tierRadius(b.id)
      const rest = Math.max(c.rest, minSep)
      const diff = ((L - rest) / L) * DRAG_STIFFNESS
      const wa = c.aMove ? (c.bMove ? 0.5 : 1) : 0
      const wb = c.bMove ? (c.aMove ? 0.5 : 1) : 0
      if (wa) { a.x += dx * diff * wa; a.y += dy * diff * wa; (a as WorkerNode & { z?: number }).z = az + dz * diff * wa }
      if (wb) { b.x -= dx * diff * wb; b.y -= dy * diff * wb; (b as WorkerNode & { z?: number }).z = bz - dz * diff * wb }
    }
    // Interleave tier collision after every link iteration (not just once at the end)
    // so the springs never win a whole pass — the neighbourhood fans out and keeps
    // readable spacing instead of collapsing toward the dragged node.
    separateDragNodes(4) // enforce tier min-distance so drags don't overlap nodes/hubs
  }
}

function clearDragState(): void {
  dragMovableSet = new Set()
  dragLinks = []
}

function runTick() {
  // Animated imported shapes never converge: advance formation time, refresh
  // targets, and hold alpha above the floor so the shape force keeps tracking.
  const animating = shapeMotionActive()
  if (animating && simulation) {
    advanceShapeMotion()
    if (simulation.alpha() < 0.12) simulation.alpha(0.12)
  }
  // Stop when max ticks reached OR simulation has converged (alpha below threshold)
  if (!simulation || (!animating && (tickCount >= MAX_TICKS || simulation.alpha() < ALPHA_MIN))) {
    tickRunning = false
    const positions = packPositions()
    post({ type: 'end', positions, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer])
    return
  }
  tickRunning = true

  // SOLUTION #1: More Frequent Worker Batches
  // Post positions EVERY 1-2 ticks (~16-32ms) instead of every 5-10 ticks (50-300ms)
  // This eliminates pause-resume stutter by keeping the main thread's RAF loop
  // in continuous motion with fresh target positions.
  const POSTING_RATE = 1  // Post every 1 tick (was: implicit 5-10 via frame budget)
  
  // Run just ONE tick per callback (don't batch within frame budget)
  simulation.tick()
  tickCount++

  // Early-exit for natural layout: if nodes are visually stable, no need to wait for alpha decay
  if (graphShape === 'natural' && simNodes.length > 0) {
    let totalDelta = 0
    for (const n of simNodes) {
      const vx = n.vx ?? 0, vy = n.vy ?? 0, vz = (n as WorkerNode & { vz?: number }).vz ?? 0
      totalDelta += Math.sqrt(vx * vx + vy * vy + vz * vz)
    }
    const meanDelta = totalDelta / simNodes.length
    if (meanDelta < 0.5) {
      stableFrameCount++
      if (stableFrameCount >= 3) {
        const positions = packPositions()
        post({ type: 'end', positions, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer])
        tickRunning = false
        return
      }
    } else {
      stableFrameCount = 0
    }
  }

  // Post every tick (POSTING_RATE = 1) — affordable now that each message is a single
  // transferable Float32Array (P1) instead of N structured-cloned objects
  if (tickCount % POSTING_RATE === 0) {
    const currentAlpha = simulation.alpha()
    const done = !animating && (tickCount >= MAX_TICKS || currentAlpha < ALPHA_MIN)
    const positions = packPositions()
    post({
      type: done ? 'end' : 'tick',
      positions,
      tickCount,
      alpha: currentAlpha,
      firstTick: tickCount <= 5,
      tagBoxes: graphShape === 'tagboxes' ? tagBoxesList : undefined,
      timestamp: performance.now(),
    }, [positions.buffer])

    if (done) {
      tickRunning = false
      return
    }
  }

  // Yield to main thread to allow RAF and other tasks (1ms is safe, 0 would be more aggressive)
  setTimeout(runTick, 1)
}

self.onmessage = (e: MessageEvent) => {
  const { type, nodes, links } = e.data as {
    type: string
    nodes?: Array<{ id: string; folder: string; tags?: string[] }>
    links?: Array<{ source: string; target: string }>
    graphShape?: GraphShape
    topN?: number
    tagBoxSizeScale?: number
  }

  if (type === 'setGraphShape') {
    graphShape = (e.data as { graphShape?: GraphShape }).graphShape ?? 'natural'
    if (graphShape.startsWith('imported:') && importedTargetsShape !== graphShape) {
      rebuildImportedTargets?.(graphShape)
    }
    if (e.data.topN != null) tagBoxTopN = e.data.topN as number
    if (e.data.tagBoxSizeScale != null) tagBoxSizeScale = e.data.tagBoxSizeScale as number
    // Build tag box targets on-demand when switching to tagboxes
    if (graphShape === 'tagboxes') {
      buildTagBoxTargets(tagBoxTopN)
      // Immediately place nodes at world-space targets (spread-independent)
      for (const node of simNodes) {
        const target = tagBoxTargets.get(node.id)
        if (!target) continue
        node.x = target.x
        node.y = target.y
        node.z = target.z
        node.vx = 0; node.vy = 0; node.vz = 0
      }
      // Emit box data immediately so wireframes appear before sim converges
      self.postMessage({ type: 'tagBoxes', tagBoxes: tagBoxesList })
    } else {
      // Clear boxes when switching away
      tagBoxesList = []
      self.postMessage({ type: 'tagBoxes', tagBoxes: [] })
    }
    // Trees: snap nodes onto the (init-computed) forest targets and re-announce
    // the branch skeleton; clear the skeleton when switching away
    if (graphShape === 'trees') {
      applyTreesSpread(currentSpread) // spread may have moved while in another shape
      for (const node of simNodes) {
        const target = treesTargets.get(node.id)
        if (!target) continue
        node.x = target.x
        node.y = target.y
        node.z = target.z
        node.vx = 0; node.vy = 0; node.vz = 0
      }
      self.postMessage({ type: 'treeBranches', treeBranches: treeBranchesList, treeLabels: treeLabelsList })
    } else {
      self.postMessage({ type: 'treeBranches', treeBranches: [], treeLabels: [] })
    }
    // Reheat sim — update forces to match new shape
    if (simulation) {
      const shapeDriven = graphShape === 'sun' || graphShape === 'milkyway' || graphShape === 'saturn' || graphShape === 'brain' || graphShape === 'tagboxes' || graphShape === 'trees' || graphShape.startsWith('imported:')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lf = simulation.force('link') as any
      if (lf?.strength) lf.strength(shapeDriven ? 0 : 0.5)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cf = simulation.force('charge') as any
      if (cf?.strength) cf.strength(shapeDriven ? 0 : -120)
      // Disable collide for shape-driven modes (forceCollide has no .strength(); null it out)
      if (shapeDriven) {
        simulation.force('collide', null)
      }
      tickCount = 0
      simulation.alpha(0.4) // lower alpha — positions already correct, just gentle settling
      if (!tickRunning) runTick()
    }
    return
  }

  // Pin nodes at specific positions (drag start)
  // Natural drag is LOCALIZED: the grabbed node is pinned to the cursor and only its
  // 1–2 hop neighbourhood springs along (PBD); every other node is a fixed anchor,
  // so the global shape can't collapse (running the full d3 sim here would pull all
  // 10k nodes toward the sim's blob equilibrium). Other shapes keep the sim reheat.
  if (type === 'pinNodes') {
    const pinned = (e.data as { pinned?: Array<{ id: string; x: number; y: number; z: number }> }).pinned ?? []
    for (const p of pinned) {
      const node = simNodes.find(n => n.id === p.id)
      if (node) { node.fx = p.x; node.fy = p.y; node.fz = p.z; node.x = p.x; node.y = p.y; node.z = p.z }
    }
    if (graphShape !== 'natural' && simulation) {
      tickCount = 0; stableFrameCount = 0; simulation.alpha(0.4)
      if (!tickRunning) runTick()
    } else {
      // Capture the local neighbourhood + link rest-lengths for the drag.
      buildDragNeighborhood(pinned.map(p => p.id))
    }
    const positions = packPositions()
    post({ type: 'tick', positions, tickCount, alpha: simulation?.alpha() ?? 0, timestamp: performance.now() }, [positions.buffer])
    return
  }

  if (type === 'moveNodes') {
    const pinned = (e.data as { pinned?: Array<{ id: string; x: number; y: number; z: number }> }).pinned ?? []
    for (const p of pinned) {
      const node = simNodes.find(n => n.id === p.id)
      if (node) { node.fx = p.x; node.fy = p.y; node.fz = p.z; node.x = p.x; node.y = p.y; node.z = p.z }
    }
    if (graphShape !== 'natural') {
      // Reheat each move so connected nodes keep following
      if (simulation) {
        if (simulation.alpha() < 0.25) simulation.alpha(0.35)
        if (!tickRunning) { tickCount = 0; stableFrameCount = 0; runTick() }
      }
    } else {
      // Natural: spring the local neighbourhood toward the moved node (PBD), then
      // stream the frame. The rest of the graph is untouched — no collapse.
      solveDragRelax(DRAG_ITERS)
      const positions = packPositions()
      post({ type: 'tick', positions, tickCount, alpha: 0, timestamp: performance.now() }, [positions.buffer])
    }
    return
  }

  // Clear ALL pinned nodes. Non-natural reheats to re-form the shape; natural just
  // clears pins (Reset All restores the cached layout via applyPositions).
  if (type === 'resetPins') {
    for (const node of simNodes) {
      delete node.fx; delete node.fy; delete node.fz
      node.vx = 0; node.vy = 0; node.vz = 0
    }
    clearDragState()
    if (graphShape !== 'natural' && simulation) {
      tickCount = 0; stableFrameCount = 0; simulation.alpha(0.6)
      if (!tickRunning) runTick()
    }
    return
  }

  // Finalise drag — keep fx/fy/fz at the dropped position.
  if (type === 'unpinNodes') {
    const ids = (e.data as { ids?: string[] }).ids ?? []
    for (const id of ids) {
      const node = simNodes.find(n => n.id === id)
      if (node) { node.vx = 0; node.vy = 0; node.vz = 0 }
    }
    if (graphShape !== 'natural' && simulation) {
      simulation.alpha(0.12)
      if (!tickRunning) { tickCount = 0; stableFrameCount = 0; runTick() }
    } else {
      // Natural: a few more relax iterations to settle the neighbourhood, then emit
      // the final frame and clear drag state (no global sim).
      solveDragRelax(DRAG_ITERS * 2)
      // Bake the dropped neighbourhood into the min-distance BASE layout so a later
      // slider change (which re-polishes from base) doesn't snap the drag back.
      if (basePositions && basePositions.length === simNodes.length * 3) {
        for (const id of [...ids, ...dragMovableSet]) {
          const i = nodeIndexMap.get(id)
          const n = nodeByIdMap.get(id)
          if (i === undefined || !n) continue
          basePositions[i * 3] = n.x ?? 0
          basePositions[i * 3 + 1] = n.y ?? 0
          basePositions[i * 3 + 2] = (n as WorkerNode & { z?: number }).z ?? 0
        }
      }
      clearDragState()
      const positions = packPositions()
      post({ type: 'end', positions, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer])
    }
    return
  }

  if (type === 'init') {
    initGeneration++
    tickRunning = false
    tickCount = 0
    stableFrameCount = 0
    if (e.data.graphShape) graphShape = e.data.graphShape
    if (e.data.spread != null) currentSpread = e.data.spread
    if (e.data.topN != null) tagBoxTopN = e.data.topN as number
    if (e.data.tagBoxSizeScale != null) tagBoxSizeScale = e.data.tagBoxSizeScale as number
    // Bake the persisted per-tier min-distance into MIN_DIST_* BEFORE the precalc runs, so
    // finishPrecalc's per-tier polish uses the user's settings (not the defaults) at load.
    {
      const md = e.data.minDist as { regular?: number; super?: number; ultra?: number } | undefined
      if (md) {
        if (typeof md.regular === 'number' && Number.isFinite(md.regular)) MIN_DIST_REGULAR = md.regular
        if (typeof md.super === 'number' && Number.isFinite(md.super)) MIN_DIST_SUPER = md.super
        if (typeof md.ultra === 'number' && Number.isFinite(md.ultra)) MIN_DIST_ULTRA = md.ultra
      }
    }

    // Warm restart: if existing positions are provided (shape-only change), reuse them
    // so nodes start near their previous locations instead of random scatter
    const warmPositions = new Map<string, { x: number; y: number; z: number }>()
    if (e.data.existingPositions) {
      for (const p of e.data.existingPositions as Array<{ id: string; x: number; y: number; z: number }>) {
        warmPositions.set(p.id, { x: p.x, y: p.y, z: p.z })
      }
    }

    simNodes = (nodes ?? []).map((n) => {
      const warm = warmPositions.get(n.id)
      return {
        id: n.id,
        folder: n.folder,
        tags: n.tags ?? [],
        x: warm?.x ?? (Math.random() - 0.5) * 400,
        y: warm?.y ?? (Math.random() - 0.5) * 400,
        z: warm?.z ?? (Math.random() - 0.5) * 400,
        vx: 0,
        vy: 0,
        vz: 0,
      }
    })

    const simLinks: WorkerLink[] = (links ?? []).map(l => ({
      source: l.source,
      target: l.target,
    }))

    nodeByIdMap = new Map(simNodes.map(n => [n.id, n]))
    nodeIndexMap = new Map(simNodes.map((n, i) => [n.id, i]))
    basePositions = null // node set/order changed — base recaptured on the natural paths below
    dragMovableSet = new Set(); dragLinks = [] // any in-flight drag is invalidated by re-init

    // Compute connected components via union-find to identify isolated sub-clusters
    const allNodeIds = simNodes.map(n => n.id)
    const parent = new Map<string, string>()
    for (const id of allNodeIds) parent.set(id, id)

    function find(x: string): string {
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
      return parent.get(x)!
    }
    function unite(a: string, b: string) { parent.set(find(a), find(b)) }
    for (const l of links ?? []) unite(l.source, l.target)

    // Group by component root, find largest
    const components = new Map<string, string[]>()
    for (const id of allNodeIds) {
      const root = find(id)
      if (!components.has(root)) components.set(root, [])
      components.get(root)!.push(id)
    }
    let largestRoot = ''
    let largestSize = 0
    for (const [root, members] of components) {
      if (members.length > largestSize) { largestSize = members.length; largestRoot = root }
    }

    // All nodes NOT in the largest component (orphans + isolated sub-clusters)
    const isolatedIds = new Set<string>()
    for (const [root, members] of components) {
      if (root !== largestRoot) for (const id of members) isolatedIds.add(id)
    }

    // Radial pull toward origin for isolated nodes (0.08 = moderate, tunable)
    // Disabled in tagboxes mode — shapeForce + AABB containment handle placement there.
    // isolatedForce (k=0.08) would overpower the shapeForce (k=0.012) and drain nodes from distant boxes.
    // Also disabled in trees mode: every note has an authored branch-tip target,
    // and this pull displaces orphan notes ~9% toward origin (0.08 vs the 0.8
    // shape force) — visibly detaching them from trees at the row edges.
    const isolatedForce = (alpha: number) => {
      if (graphShape === 'tagboxes' || graphShape === 'trees') return
      const k = alpha * 0.08
      for (const node of simNodes) {
        if (isolatedIds.has(node.id)) {
          node.vx -= node.x * k
          node.vy -= node.y * k
          node.vz -= node.z * k
        }
      }
    }

    // Identify degree-0 orphan nodes (no links at all)
    const degreeMap = new Map<string, number>()
    for (const id of allNodeIds) degreeMap.set(id, 0)
    for (const l of links ?? []) {
      degreeMap.set(l.source, (degreeMap.get(l.source) ?? 0) + 1)
      degreeMap.set(l.target, (degreeMap.get(l.target) ?? 0) + 1)
    }

    // ── Semantic 3-tier node classification ─────────────────────────────────
    // Build adjacency map for hub-of-hubs detection
    const adjacencyMap = new Map<string, string[]>()
    for (const id of allNodeIds) adjacencyMap.set(id, [])
    for (const l of links ?? []) {
      adjacencyMap.get(l.source)?.push(l.target)
      adjacencyMap.get(l.target)?.push(l.source)
    }
    workerAdjacency = adjacencyMap // expose for the localized drag relax

    // Supernodes: folder-index MOCs + high-degree hubs. A node is a supernode if it is
    // tagged `moc` (with a few real links) OR is simply high-degree — so both the vault's
    // MOC hubs AND big connector notes that aren't formally MOCs (Openclaw, Lessons:X…)
    // count. Empty Dataview-only topic MOCs (deg < MOC_MIN_DEGREE) are excluded so they
    // don't float as disconnected supernode-sized dots.
    const SUPERNODE_MIN_DEGREE = 15        // high-degree hub, MOC or not
    const MOC_MIN_DEGREE = 3               // an `moc`-tagged node needs at least this to count as a hub
    const ULTRANODE_MIN_SUPER_LINKS = 4    // nexus: links to >3 distinct supernodes
    const mocIds = new Set<string>()
    for (const n of simNodes) if ((n.tags ?? []).includes('moc')) mocIds.add(n.id)
    const supernodeIds = new Set<string>()
    for (const [id, deg] of degreeMap) {
      if (deg >= SUPERNODE_MIN_DEGREE || (mocIds.has(id) && deg >= MOC_MIN_DEGREE)) supernodeIds.add(id)
    }

    // Ultranodes: a supernode that itself connects to >3 OTHER supernodes (hub-of-hubs / nexus).
    // Absolute count of distinct supernode neighbours — NOT a ratio. The old ratio test was
    // trivially satisfied by low-degree nodes (2 of 2 neighbours = ultra) and missed true hubs.
    tierMap = new Map<string, 'regular' | 'supernode' | 'ultranode'>()
    for (const id of allNodeIds) {
      if (!supernodeIds.has(id)) {
        tierMap.set(id, 'regular')
        continue
      }
      const superNeighbours = new Set<string>()
      for (const nid of adjacencyMap.get(id) ?? []) {
        if (nid !== id && supernodeIds.has(nid)) superNeighbours.add(nid)
      }
      tierMap.set(id, superNeighbours.size >= ULTRANODE_MIN_SUPER_LINKS ? 'ultranode' : 'supernode')
    }
    // dev aid — verify tier counts in devtools console
    {
      let s = 0, u = 0
      for (const t of tierMap.values()) { if (t === 'supernode') s++; else if (t === 'ultranode') u++ }
      console.log(`[tier] supernodes=${s} ultranodes=${u} (super: moc-tag or deg>=${SUPERNODE_MIN_DEGREE}; ultra: >3 supernode links)`)
    }
    // ────────────────────────────────────────────────────────────────────────

    // Collect all degree-0 orphan nodes sorted deterministically by id
    const allOrphans: WorkerNode[] = simNodes
      .filter(n => (degreeMap.get(n.id) ?? 0) === 0)
      .sort((a, b) => a.id.localeCompare(b.id))

    // Group orphan nodes by folder (used by centroid affinity force)
    const orphansByFolder = new Map<string, WorkerNode[]>()
    for (const node of allOrphans) {
      const f = node.folder
      if (!orphansByFolder.has(f)) orphansByFolder.set(f, [])
      orphansByFolder.get(f)!.push(node)
    }

    // All connected nodes grouped by component, sorted by component size (largest first)
    const connectedNodeIds = new Set<string>()
    for (const [id, deg] of degreeMap) {
      if (deg > 0) connectedNodeIds.add(id)
    }
    const allClusters: string[][] = []
    for (const [, members] of components) {
      const connected = members.filter(id => connectedNodeIds.has(id))
      if (connected.length > 0) allClusters.push(connected)
    }
    allClusters.sort((a, b) => b.length - a.length)
    const connectedCount = allClusters.reduce((sum, c) => sum + c.length, 0)

    // ── Saturn target positions ─────────────────────────────────────────────
    const saturnTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      const R_base = 150 + Math.sqrt(connectedCount) * 3
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))  // ~2.399 rad

      // Planet body: single-radius Fibonacci sphere — clean spherical shell
      const allConnectedFlat: string[] = []
      for (const cluster of allClusters) {
        for (const nodeId of cluster) allConnectedFlat.push(nodeId)
      }

      for (let i = 0; i < allConnectedFlat.length; i++) {
        const nodeId = allConnectedFlat[i]
        const phi = Math.acos(1 - 2 * (i + 0.5) / allConnectedFlat.length)
        const theta = i * goldenAngle

        saturnTargets.set(nodeId, {
          x: R_base * Math.sin(phi) * Math.cos(theta),
          y: R_base * Math.cos(phi),
          z: R_base * Math.sin(phi) * Math.sin(theta),
        })
      }

      // Single ring of orphan nodes — Saturn's iconic ring
      // Tilted 26.7° (Saturn's actual axial tilt), flat disc in tilted XZ plane
      if (allOrphans.length > 0) {
        const TILT_RAD = 26.7 * Math.PI / 180  // Saturn's axial tilt
        const cosTilt = Math.cos(TILT_RAD)
        const sinTilt = Math.sin(TILT_RAD)
        const RING_INNER = R_base * 1.6
        const RING_OUTER = R_base * 2.2

        allOrphans.forEach((node, idx) => {
          // Slight angular clustering every ~8 nodes for visual density variation
          const clusterPhase = Math.floor(idx / 8) * 0.3
          const angle = (idx / allOrphans.length) * Math.PI * 2 + clusterPhase
          // Radial scatter for ring thickness (deterministic via golden ratio)
          const radialFrac = ((idx * 0.6180339887498949) % 1)
          const r = RING_INNER + radialFrac * (RING_OUTER - RING_INNER)

          // Position in flat ring plane, then tilt around X axis by 26.7°
          const flatX = r * Math.cos(angle)
          const flatZ = r * Math.sin(angle)
          const flatY = ((idx * 1.6180339887498949) % 1 - 0.5) * 4  // minimal Y scatter

          saturnTargets.set(node.id, {
            x: flatX,
            y: flatY * cosTilt + flatZ * sinTilt,
            z: -flatY * sinTilt + flatZ * cosTilt,
          })
        })
      }
    }

    // ── Sun target positions (hierarchical sphere) ───────────────────────────
    const sunTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      // Mirror Saturn's proven Fibonacci sphere algorithm — just use tier-based radii.
      // R_outer = same as Saturn (not 2× — keeps camera framing natural)
      const R_outer = 150 + Math.sqrt(connectedCount) * 3
      const R_inner = R_outer * 0.67   // supernode shell at 2/3 radius
      const R_ultra = R_outer * 0.33   // ultranode shell at 1/3 radius
      sunOuterRadius = R_outer
      sunInnerRadius = R_inner

      const goldenAngle = Math.PI * (3 - Math.sqrt(5))

      // Each tier gets its own independent Fibonacci sphere so nodes fill their
      // shell uniformly rather than clustering at the pole of a shared sequence.
      const allNodes: string[] = []
      for (const cluster of allClusters) for (const id of cluster) allNodes.push(id)
      for (const n of allOrphans) allNodes.push(n.id)

      const byTier: Record<string, string[]> = { ultranode: [], supernode: [], regular: [] }
      for (const id of allNodes) {
        const t = tierMap.get(id) ?? 'regular'
        byTier[t].push(id)
      }

      const placeTier = (ids: string[], R: number) => {
        const N = ids.length
        ids.forEach((id, i) => {
          const phi = Math.acos(1 - 2 * (i + 0.5) / Math.max(N, 1))
          const theta = i * goldenAngle
          sunTargets.set(id, {
            x: R * Math.sin(phi) * Math.cos(theta),
            y: R * Math.cos(phi),
            z: R * Math.sin(phi) * Math.sin(theta),
          })
        })
      }

      // Step 1: place regular nodes and ultranodes on their shells
      placeTier(byTier.regular,   R_outer)
      placeTier(byTier.ultranode, R_ultra)

      // Step 2: anchor each supernode near its connected regular nodes.
      // Average the unit vectors of connected surface nodes → gives a direction
      // on the outer sphere → scale to R_inner so supernode clusters near its neighbours.
      const fallbackSuper: string[] = []
      for (const id of byTier.supernode) {
        const neighbours = adjacencyMap.get(id) ?? []
        const regularNeighbours = neighbours.filter(nid => tierMap.get(nid) === 'regular')
        if (regularNeighbours.length === 0) {
          fallbackSuper.push(id)
          continue
        }
        // Average unit vectors of connected regular nodes (already have targets)
        let sx = 0, sy = 0, sz = 0
        for (const nid of regularNeighbours) {
          const t = sunTargets.get(nid)
          if (!t) continue
          const r = Math.sqrt(t.x * t.x + t.y * t.y + t.z * t.z) || 1
          sx += t.x / r; sy += t.y / r; sz += t.z / r
        }
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
        sunTargets.set(id, {
          x: (sx / len) * R_inner,
          y: (sy / len) * R_inner,
          z: (sz / len) * R_inner,
        })
      }
      // Fallback: supernodes with no regular neighbours → even Fibonacci shell
      placeTier(fallbackSuper, R_inner)
    }


    // ── Milky Way target positions (density-gradient disc with spiral arms) ──
    // Approach: distribute ALL nodes across the full galactic disc. Nodes near
    // spiral arm curves get pulled closer to them (higher density), nodes between
    // arms spread naturally (lower density). The arms appear as density waves,
    // not exclusive thin tracks. Like real galaxies — stars everywhere, denser in arms.
    const milkywayTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      const totalNodes = connectedCount + allOrphans.length
      const galaxyRadius = 120 + Math.sqrt(totalNodes) * 8  // overall disc radius
      const NUM_ARMS = 2           // 2 arms — clearest spiral visibility
      const SPIRAL_TIGHTNESS = 0.5   // controls how tightly wound the arms are
      const ARM_ATTRACTION = 0.85   // 0=uniform disc, 1=nodes only on arms — high for bold arms

      // Collect all node IDs in one array: connected first, then orphans
      const allNodeIds: string[] = []
      for (const cluster of allClusters) {
        for (const id of cluster) allNodeIds.push(id)
      }
      for (const orphan of allOrphans) allNodeIds.push(orphan.id)

      // Golden angle for Fibonacci disc base distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))

      // Central bulge: first 15% of nodes get packed in the center
      const bulgeCount = Math.floor(totalNodes * 0.20)  // 20% of nodes in central bulge
      const bulgeRadius = galaxyRadius * 0.20  // bulge fills 20% of galaxy radius

      for (let i = 0; i < allNodeIds.length; i++) {
        const nodeId = allNodeIds[i]
        let x: number, z: number, y: number

        if (i < bulgeCount) {
          // Central bulge: tight Fibonacci disc
          const r = bulgeRadius * Math.sqrt((i + 0.5) / bulgeCount)
          const theta = i * goldenAngle
          x = r * Math.cos(theta) * 1.3  // slight ellipticity for bar
          z = r * Math.sin(theta)
          y = ((i * 1.6180339887498949) % 1 - 0.5) * 3  // tiny Y spread
        } else {
          // Disc nodes: Fibonacci disc distribution, then attracted toward nearest arm
          const discIdx = i - bulgeCount
          const discTotal = totalNodes - bulgeCount

          // Base position: Fibonacci disc (even spread across full disc)
          const baseR = bulgeRadius + (galaxyRadius - bulgeRadius) * Math.sqrt((discIdx + 0.5) / discTotal)
          const baseTheta = discIdx * goldenAngle

          // Find the nearest spiral arm point and pull toward it
          // Spiral arm equation: theta_arm = ln(r / a) / b + offset
          // For Archimedean: theta_arm = (r - bulgeRadius) * TIGHTNESS / galaxyRadius + offset
          // Find nearest major spiral arm (2 arms only — clean, bold)
          let minAngDist = Infinity

          for (let arm = 0; arm < NUM_ARMS; arm++) {
            const armOffset = (arm / NUM_ARMS) * 2 * Math.PI
            // Spiral arm angle at this radius
            const armTheta = ((baseR - bulgeRadius) / galaxyRadius) * SPIRAL_TIGHTNESS * 2 * Math.PI * 3 + armOffset
            // Angular distance (wrapped to -PI..PI)
            let angDist = baseTheta - armTheta
            angDist = angDist - Math.round(angDist / (2 * Math.PI)) * 2 * Math.PI
            if (Math.abs(angDist) < Math.abs(minAngDist)) {
              minAngDist = angDist
            }
          }

          // Pull all nodes toward nearest arm — stronger pull = more visible arms
          const attractedTheta = baseTheta - minAngDist * ARM_ATTRACTION
          const r = baseR

          // Add slight radial scatter for naturalness
          // More organic scatter — radial + angular jitter
          const radialScatter = ((discIdx * 2.236) % 1 - 0.5) * galaxyRadius * 0.06
          const angularJitter = ((discIdx * 3.1415) % 1 - 0.5) * 0.04

          x = (r + radialScatter) * Math.cos(attractedTheta + angularJitter)
          z = (r + radialScatter) * Math.sin(attractedTheta + angularJitter)
          y = ((discIdx * 1.6180339887498949) % 1 - 0.5) * 2  // very flat
        }

        milkywayTargets.set(nodeId, { x, y, z })
      }
    }

    // ── Brain target positions (mesh-based — real low-poly brain vertices) ──
    const brainTargets = new Map<string, { x: number; y: number; z: number }>()

    {
      const R = 150 + Math.sqrt(connectedCount) * 3

      // Post-process mesh: exaggerate anatomical features for visual clarity
      // Raw mesh is near-spherical; we need to amplify fissures/lobes/separations
      const processedMesh: [number, number, number][] = BRAIN_MESH.map(([vx, vy, vz]) => {
        let x = vx, y = vy, z = vz

        // 1. Medial fissure: deep groove down the middle, splitting hemispheres
        //    Wide zone (|z|<0.25), strong push, creates visible valley
        if (Math.abs(z) < 0.25 && y > -0.2) {
          const proximity = 1 - Math.abs(z) / 0.25  // 1 at midline, 0 at edges
          const heightFactor = Math.max(0, 0.3 + y * 0.7)  // stronger near top
          const fissureStrength = proximity * proximity * heightFactor  // quadratic falloff
          z += (z >= 0 ? 1 : -1) * fissureStrength * 0.28  // strong lateral push
          y -= fissureStrength * 0.15  // groove dips inward
        }

        // 2. Temporal lobes: dramatic lateral bulges on lower sides
        //    These must be WIDER than cerebrum above — the defining feature
        if (y < 0 && y > -0.6 && Math.abs(z) > 0.2) {
          const lateralFactor = Math.min(1, (Math.abs(z) - 0.2) / 0.4)
          const verticalFactor = Math.min(1, Math.max(0, -y / 0.4))
          const temporalFactor = lateralFactor * verticalFactor
          z *= 1 + temporalFactor * 0.5   // push outward strongly
          y -= temporalFactor * 0.15       // pull down
          x *= 1 + temporalFactor * 0.1   // slight anterior spread
        }

        // 3. Sylvian fissure: gap between temporal lobe and cerebrum
        //    Create a horizontal groove at the temporal/cerebrum boundary
        if (y > -0.25 && y < 0.05 && Math.abs(z) > 0.35) {
          const sylvianFactor = 1 - Math.abs(y - (-0.1)) / 0.15
          if (sylvianFactor > 0) {
            z *= 1 - sylvianFactor * 0.08  // pinch inward at boundary
          }
        }

        // 4. Cerebellum: separate dense structure at posterior-inferior
        //    Must be clearly detached from cerebrum with visible gap
        if (x < -0.3 && y < -0.2) {
          const backFactor = Math.min(1, (-0.3 - x) / 0.5)
          const lowFactor = Math.min(1, (-0.2 - y) / 0.4)
          const cerebellumFactor = backFactor * lowFactor
          y -= cerebellumFactor * 0.35  // pull down significantly
          x -= cerebellumFactor * 0.2   // pull back
          // Compress cerebellum to be denser/smaller
          const cx = -0.7, cy = -0.7  // cerebellum center after pull
          x = cx + (x - cx) * (1 - cerebellumFactor * 0.15)
          y = cy + (y - cy) * (1 - cerebellumFactor * 0.15)
        }

        // 5. Brainstem: compact cylinder stretching down from base
        //    Much more aggressive stretch + compression
        if (y < -0.55 && Math.abs(z) < 0.25) {
          const stemFactor = Math.min(1, (-0.55 - y) / 0.3)
          // Only narrow non-cerebellum vertices (front/center of bottom)
          if (x > -0.5) {
            y -= stemFactor * 0.6   // stretch way down
            x *= 1 - stemFactor * 0.5  // compress X
            z *= 1 - stemFactor * 0.6  // compress Z hard
          }
        }

        // 6. Scale: cerebrum wider than tall (oblate), give overall brain proportions
        x *= 1.2   // wider front-to-back
        z *= 1.15  // wider laterally
        y *= 1.05  // slightly taller

        return [x, y, z]
      })

      // Collect all node IDs: connected first, then orphans
      const allBrainNodes: string[] = []
      for (const cluster of allClusters) {
        for (const id of cluster) allBrainNodes.push(id)
      }
      for (const orphan of allOrphans) allBrainNodes.push(orphan.id)

      const totalNodes = allBrainNodes.length
      const meshCount = processedMesh.length

      // Distribute nodes evenly across mesh vertices
      for (let i = 0; i < totalNodes; i++) {
        const nodeId = allBrainNodes[i]
        const vertIdx = Math.floor(i * meshCount / totalNodes) % meshCount
        const vert = processedMesh[vertIdx]

        // Small jitter for nodes sharing same vertex region
        const jx = ((i * 2.236) % 1 - 0.5) * R * 0.03
        const jy = ((i * 1.618) % 1 - 0.5) * R * 0.03
        const jz = ((i * 3.142) % 1 - 0.5) * R * 0.03

        brainTargets.set(nodeId, {
          x: vert[0] * R + jx,
          y: vert[1] * R + jy,
          z: vert[2] * R + jz,
        })
      }
    }

    // ── Trees target positions (fractal trees on a horizontal ground plane) ──
    // One fractal tree per top-level folder, grown with the stochastic
    // binary-split algorithm ported from someuser-321/TreeGenerator (TreeD.js,
    // MIT, credited in README). The folder's root note sits at the trunk base,
    // and the folder's notes hang as leaf clusters on the branch tips in
    // depth-first folder order, so each subfolder occupies a contiguous bough.
    // Root-level vault notes scatter on the ground between trees. World-space
    // targets, spread-independent, so the exported branch skeleton
    // (treeBranchesList) always matches node positions. Node ids are relative
    // vault paths, so the folder chain comes straight from the id.
    treeBranchesList = []
    treesTargets = new Map<string, { x: number; y: number; z: number }>()
    treesStaticTargets = new Map()
    treesLocalTargets = new Map()
    treesLocalBranches = []
    treeLabelsList = []

    {
      const TREE_GAP = 210           // gap between trees along a row (~50% more spread)
      const ROW_DEPTH = 720          // z distance between rows (~50% more spread)
      const golden = Math.PI * (3 - Math.sqrt(5))
      // TreeGenerator parameters (defaults of the TreeD.js sliders)
      const ROT = 0.125              // split angle, fraction of π
      const ROT_RAND = 0.4           // split rotation variation
      const LEN_RAND = 0.35          // branch length variation

      interface FolderInfo { key: string; depth: number; children: string[]; notes: string[] }
      const folderMap = new Map<string, FolderInfo>()
      const ensureFolder = (key: string): FolderInfo => {
        let f = folderMap.get(key)
        if (!f) {
          f = { key, depth: key === '' ? -1 : key.split('/').length - 1, children: [], notes: [] }
          folderMap.set(key, f)
          if (key !== '') {
            const parentKey = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : ''
            ensureFolder(parentKey).children.push(key)
          }
        }
        return f
      }
      ensureFolder('')
      for (const node of simNodes) {
        const slash = node.id.lastIndexOf('/')
        ensureFolder(slash === -1 ? '' : node.id.slice(0, slash)).notes.push(node.id)
      }

      // Subtree note counts (bottom-up), used for tree sizing and bough order
      const countMap = new Map<string, number>()
      const computeCount = (key: string): number => {
        const f = folderMap.get(key)!
        let c = f.notes.length
        for (const ch of f.children) c += computeCount(ch)
        countMap.set(key, c)
        return c
      }
      const treeKeys = folderMap.get('')!.children
      for (const t of treeKeys) computeCount(t)

      // Deterministic per-folder variation (0..1) — stable across reloads
      const hash01 = (key: string) => {
        let h = 7
        for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 997
        return h / 997
      }

      // Seeded PRNG (mulberry32) — replaces p5's randomSeed()/random()
      const mulberry32 = (a: number) => {
        let s = a | 0
        return () => {
          s = (s + 0x6D2B79F5) | 0
          let t = Math.imul(s ^ (s >>> 15), 1 | s)
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
      }

      // Column-major 3×3 rotation helpers for the branch local frame
      type Mat3 = [number, number, number, number, number, number, number, number, number]
      const IDENT: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
      const matMul = (a: Mat3, b: Mat3): Mat3 => {
        const c = new Array(9) as Mat3
        for (let j = 0; j < 3; j++) {
          for (let i = 0; i < 3; i++) {
            c[3 * j + i] = a[i] * b[3 * j] + a[3 + i] * b[3 * j + 1] + a[6 + i] * b[3 * j + 2]
          }
        }
        return c
      }
      const rotY = (t: number): Mat3 => {
        const c = Math.cos(t), s = Math.sin(t)
        return [c, 0, -s, 0, 1, 0, s, 0, c]
      }
      const rotX = (t: number): Mat3 => {
        const c = Math.cos(t), s = Math.sin(t)
        return [1, 0, 0, 0, c, s, 0, -s, c]
      }

      // Data-driven port of TreeD.js branch(): the recursion follows the vault
      // hierarchy instead of a fixed depth. Each branch carries a work list of
      // items (notes and whole subfolders): one note left → the branch ends and
      // that note IS the tip (every tip is a node, no empty branches); a single
      // subfolder left → its root/MOC note marks the junction at the branch end
      // and the folder's contents continue from there; several items → split in
      // two contiguous halves of ~equal weight using TreeGenerator's yaw/pitch
      // rotations and 1/level length falloff.
      interface RawSeg { ax: number; ay: number; az: number; bx: number; by: number; bz: number }
      interface BranchItem { note?: string; folder?: string; weight: number }

      // A folder's root note anchors its junction ONLY when a genuine index-like
      // note exists (<folder>/<folder>, moc, index, readme). No degree fallback:
      // promoting an arbitrary hub note to the base misrepresents the folder
      // (e.g. "Speculative Decoding" masquerading as the local_llm base). Bare
      // bases/junctions are fine — routing is purely path-based, and every tree
      // base carries a folder-name label regardless.
      const rootNote = (key: string): string | null => {
        const direct = folderMap.get(key)!.notes
        if (direct.length === 0) return null
        const base = key.split('/').pop()
        return direct.find(id => id === key + '/' + base)
          ?? direct.find(id => id === key + '/moc')
          ?? direct.find(id => id === key + '/index')
          ?? direct.find(id => id === key + '/readme')
          ?? null
      }

      // A folder's contents as branch items: direct notes (minus the root note,
      // which sits at the folder's junction) plus one weighted item per subfolder
      const folderItems = (key: string, excludeRoot: string | null): BranchItem[] => {
        const f = folderMap.get(key)!
        const items: BranchItem[] = []
        for (const id of f.notes) if (id !== excludeRoot) items.push({ note: id, weight: 1 })
        for (const c of f.children) items.push({ folder: c, weight: Math.max(countMap.get(c)!, 1) })
        items.sort((a, b) => b.weight - a.weight)
        return items
      }

      // Grow each tree in local coords (trunk base at origin), measure extent
      interface TreeGen { key: string; segs: RawSeg[]; locals: Map<string, { lx: number; ly: number; lz: number }>; halfW: number }
      const gens: TreeGen[] = []
      for (const key of treeKeys) {
        const count = countMap.get(key)!
        const unitLen = 60 + Math.sqrt(count) * 4.5
        const segs: RawSeg[] = []
        const locals = new Map<string, { lx: number; ly: number; lz: number }>()

        const branch = (items: BranchItem[], level: number, s: number, px: number, py: number, pz: number, m: Mat3): void => {
          const rng = mulberry32(Math.floor(s))
          const seed1 = rng() * 4294967296
          const seed2 = rng() * 4294967296
          const segLen = (unitLen / level) * (1 + (rng() * 2 - 1) * LEN_RAND)
          const ex = px + m[3] * segLen
          const ey = py + m[4] * segLen
          const ez = pz + m[5] * segLen
          segs.push({ ax: px, ay: py, az: pz, bx: ex, by: ey, bz: ez })
          // Unwrap folder chains: each folder's root note marks this junction
          let cur = items
          while (cur.length === 1 && cur[0].folder !== undefined) {
            const fkey = cur[0].folder as string
            const root = rootNote(fkey)
            if (root) locals.set(root, { lx: ex, ly: ey + 3, lz: ez })
            cur = folderItems(fkey, root)
            if (cur.length === 0) return // MOC-only folder — its junction is the tip
          }
          if (cur.length === 1 && cur[0].note !== undefined) {
            locals.set(cur[0].note as string, { lx: ex, ly: ey + 3, lz: ez }) // tip = the node
            return
          }
          // Split into two contiguous halves of ~equal weight (both non-empty)
          const total = cur.reduce((sum, it) => sum + it.weight, 0)
          let acc = 0
          let cut = 1
          for (let i = 0; i < cur.length - 1; i++) {
            acc += cur[i].weight
            cut = i + 1
            if (acc >= total / 2) break
          }
          const r11 = ROT * Math.PI * (1 + (rng() * 2 - 1) * ROT_RAND)
          const r12 = ROT * Math.PI * (1 + (rng() * 2 - 1) * ROT_RAND)
          const r21 = ROT * Math.PI * (1 + (rng() * 2 - 1) * ROT_RAND)
          const r22 = ROT * Math.PI * (1 + (rng() * 2 - 1) * ROT_RAND)
          branch(cur.slice(0, cut), level + 1, seed1, ex, ey, ez, matMul(matMul(m, rotY(Math.PI / 2 + r11)), rotX(r12)))
          branch(cur.slice(cut), level + 1, seed2, ex, ey, ez, matMul(matMul(m, rotY(Math.PI / 2 + r21)), rotX(-r22)))
        }

        // Base node: the top-level folder's root note sits at the trunk foot
        const treeRoot = rootNote(key)
        if (treeRoot) locals.set(treeRoot, { lx: 0, ly: 4, lz: 0 })
        const items = folderItems(key, treeRoot)
        if (items.length > 0) {
          branch(items, 1, Math.floor(hash01(key) * 4294967296), 0, 0, 0, IDENT)
        } else if (treeRoot) {
          // Lone-note folder (e.g. just a moc): draw a short trunk stub and put
          // the note on top so it never floats unattached in its row slot
          segs.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 40, bz: 0 })
          locals.set(treeRoot, { lx: 0, ly: 43, lz: 0 })
        }

        let halfW = 0
        for (const sg of segs) halfW = Math.max(halfW, Math.abs(sg.bx), Math.abs(sg.bz))
        gens.push({ key, segs, locals, halfW: Math.max(halfW, 40) })
      }

      // Plant trees in rows, biggest tree at the back — forest faces the camera
      gens.sort((a, b) => countMap.get(b.key)! - countMap.get(a.key)!)
      const diam = (g: TreeGen) => 2 * g.halfW + TREE_GAP
      const totalW = gens.reduce((s, g) => s + diam(g), 0)
      // Square footprint to fill the (square) ground plane: pick a row width so the
      // forest's width (≈rowLimit) matches its depth (rows × ROW_DEPTH). Solving
      // rowLimit = (totalW/rowLimit)·ROW_DEPTH gives rowLimit = √(totalW·ROW_DEPTH).
      const rowLimit = Math.max(gens.length > 0 ? diam(gens[0]) : 0, Math.sqrt(totalW * ROW_DEPTH))
      const rows: TreeGen[][] = []
      let row: TreeGen[] = []
      let rowW = 0
      for (const g of gens) {
        if (row.length > 0 && rowW + diam(g) > rowLimit) { rows.push(row); row = []; rowW = 0 }
        row.push(g); rowW += diam(g)
      }
      if (row.length > 0) rows.push(row)

      const zStart = -((rows.length - 1) * ROW_DEPTH) / 2
      rows.forEach((r, ri) => {
        const w = r.reduce((s, g) => s + diam(g), 0)
        let xCursor = -w / 2
        const tz = zStart + ri * ROW_DEPTH
        for (const g of r) {
          const tx = xCursor + diam(g) / 2
          xCursor += diam(g)
          for (const sg of g.segs) {
            treesLocalBranches.push({
              bx: tx, bz: tz,
              lax: sg.ax, lay: sg.ay, laz: sg.az,
              lbx: sg.bx, lby: sg.by, lbz: sg.bz,
            })
          }
          for (const [id, l] of g.locals) {
            treesLocalTargets.set(id, { bx: tx, bz: tz, lx: l.lx, ly: l.ly, lz: l.lz })
          }
          // Folder-name label floating at the trunk base
          treeLabelsList.push({ text: g.key, x: tx, y: 14, z: tz + 14 })
        }
      })

      // Root-level notes: fallen leaves on the ground in front of the rows
      const groundNotes = folderMap.get('')!.notes
      const forestW = Math.max(rowLimit, 400)
      const frontZ = zStart + rows.length * ROW_DEPTH
      groundNotes.forEach((id, i) => {
        treesStaticTargets.set(id, {
          x: (((i * 0.6180339887498949) % 1) - 0.5) * forestW,
          y: 3 + ((i * 0.7548776662466927) % 1) * 8,
          z: frontZ + ((i * 0.5698402909980532) % 1) * 200,
        })
      })

      // Bake the current spread into targets + skeleton (trees scale about
      // their own base points; ground scatter stays put on the plane)
      applyTreesSpread(currentSpread)
    }

    // Announce the branch skeleton (empty unless trees) so the renderer can
    // draw/remove the trunk+branch lines for this init's layout
    self.postMessage({ type: 'treeBranches', treeBranches: graphShape === 'trees' ? treeBranchesList : [], treeLabels: graphShape === 'trees' ? treeLabelsList : [] })

    // ── Tag Box targets: only pre-build if starting with tagboxes shape ──
    if (graphShape === 'tagboxes') buildTagBoxTargets(tagBoxTopN)

    // ── Imported shape targets (ported swarm position functions, src/shapes/) ──
    const applyImportedDef = (def: ImportedShapeDef) => {
      // Hubs first: position functions reserve low indices for focal regions
      const ordered = [...simNodes].sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0))
      const rng = mulberry32(0x6a72)
      const targets = new Map<string, { x: number; y: number; z: number }>()
      ordered.forEach((node, i) => {
        targets.set(node.id, def.position(i, ordered.length, rng))
      })
      importedTargets = targets
      importedDefActive = def
      importedOrdered = ordered
      shapeTime = 0
    }
    rebuildImportedTargets = (shape: string) => {
      importedTargetsShape = shape
      importedTargets = new Map()
      importedDefActive = null
      importedOrdered = null
      const staticDef = getImportedShape(shape)
      if (staticDef) {
        applyImportedDef(staticDef)
        return
      }
      // Dynamic shapes (community cloud) resolve async: fetch + compile, then
      // fill targets and reheat so the swarm morphs when they arrive.
      resolveImportedShape(shape)
        .then((def) => {
          if (importedTargetsShape !== shape) return // superseded by another switch
          if (!def) {
            console.warn(`[force3d] unknown imported shape "${shape}" — no targets built`)
            post({ type: 'shapeError', shape, message: 'shape not found in the community cloud' })
            return
          }
          applyImportedDef(def)
          tickCount = 0
          stableFrameCount = 0
          simulation?.alpha(0.5)
          if (!tickRunning) runTick()
        })
        .catch((err) => {
          if (importedTargetsShape !== shape) return
          console.warn(`[force3d] imported shape "${shape}" failed to load:`, err)
          // Strip our own prefixes for a human-readable reason
          const raw = err instanceof Error ? err.message : String(err)
          const message = raw.replace(/^formation "[^"]*"\s*/, '').replace(/^Error:\s*/, '')
          post({ type: 'shapeError', shape, message })
        })
    }
    if (graphShape.startsWith('imported:')) rebuildImportedTargets(graphShape)

    // ── Set initial positions based on active shape ─────────────────────────
    if (graphShape === 'sun') {
      for (const node of simNodes) {
        const target = sunTargets.get(node.id)
        if (!target) continue
        node.x = target.x * currentSpread + (Math.random() - 0.5) * 20
        node.y = target.y * currentSpread + (Math.random() - 0.5) * 20
        node.z = target.z * currentSpread + (Math.random() - 0.5) * 20
      }
    } else if (graphShape === 'saturn') {
      for (const node of simNodes) {
        const target = saturnTargets.get(node.id)
        if (!target) continue
        node.x = target.x * currentSpread + (Math.random() - 0.5) * 20
        node.y = target.y * currentSpread + (Math.random() - 0.5) * 20
        node.z = target.z * currentSpread + (Math.random() - 0.5) * 20
      }
    } else if (graphShape === 'milkyway') {
      for (const node of simNodes) {
        const target = milkywayTargets.get(node.id)
        if (!target) continue
        node.x = target.x * currentSpread + (Math.random() - 0.5) * 20
        node.y = target.y * currentSpread + (Math.random() - 0.5) * 20
        node.z = target.z * currentSpread + (Math.random() - 0.5) * 20
      }
    } else if (graphShape === 'brain') {
      for (const node of simNodes) {
        const target = brainTargets.get(node.id)
        if (!target) continue
        node.x = target.x * currentSpread + (Math.random() - 0.5) * 20
        node.y = target.y * currentSpread + (Math.random() - 0.5) * 20
        node.z = target.z * currentSpread + (Math.random() - 0.5) * 20
      }
    } else if (graphShape.startsWith('imported:')) {
      for (const node of simNodes) {
        const target = importedTargets.get(node.id)
        if (!target) continue
        node.x = target.x * currentSpread + (Math.random() - 0.5) * 20
        node.y = target.y * currentSpread + (Math.random() - 0.5) * 20
        node.z = target.z * currentSpread + (Math.random() - 0.5) * 20
      }
    } else if (graphShape === 'trees') {
      // World-space positions — spread-independent (branch skeleton lines must match)
      for (const node of simNodes) {
        const target = treesTargets.get(node.id)
        if (!target) continue
        node.x = target.x + (Math.random() - 0.5) * 14
        node.y = target.y + (Math.random() - 0.5) * 14
        node.z = target.z + (Math.random() - 0.5) * 14
      }
    } else if (graphShape === 'tagboxes') {
      // World-space positions — spread-independent
      for (const node of simNodes) {
        const target = tagBoxTargets.get(node.id)
        if (!target) continue
        node.x = target.x
        node.y = target.y
        node.z = target.z
      }
    }

    // ── Shape force: pulls nodes toward their target positions ──────────────
    const shapeForce = (alpha: number) => {
      if (graphShape === 'natural') {
        // Same-folder orphans attract each other; scale with spread so centroid pull
        // keeps pace with the repulsive charge (which also scales with spread)
        const k = alpha * 0.012 * currentSpread
        for (const members of orphansByFolder.values()) {
          if (members.length < 2) continue
          let cx = 0, cy = 0, cz = 0
          for (const n of members) { cx += n.x; cy += n.y; cz += n.z }
          cx /= members.length; cy /= members.length; cz /= members.length
          for (const n of members) {
            n.vx += (cx - n.x) * k
            n.vy += (cy - n.y) * k
            n.vz += (cz - n.z) * k
          }
        }
      } else if (graphShape === 'sun') {
        // Single force matching Saturn's approach — pull toward precomputed target
        const k = alpha * 0.8
        for (const node of simNodes) {
          const target = sunTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else if (graphShape === 'saturn') {
        // Pull all nodes toward Saturn sphere/ring targets (very strong snap to surface)
        const k = alpha * 0.8
        for (const node of simNodes) {
          const target = saturnTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else if (graphShape === 'milkyway') {
        // Pull all nodes toward Milky Way spiral targets (extremely strong — shape formula dominates)
        const k = alpha * 0.8
        for (const node of simNodes) {
          const target = milkywayTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else if (graphShape === 'brain') {
        // Pull all nodes toward brain anatomy targets (strong — shape formula dominates)
        const k = alpha * 0.8
        for (const node of simNodes) {
          const target = brainTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else if (graphShape.startsWith('imported:')) {
        // Pull toward imported-shape targets (strong — ported formula dominates)
        const k = alpha * 0.8
        for (const node of simNodes) {
          const target = importedTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x * currentSpread - node.x) * k
          node.vy += (target.y * currentSpread - node.y) * k
          node.vz += (target.z * currentSpread - node.z) * k
        }
      } else if (graphShape === 'trees') {
        // Pull all nodes toward forest targets (strong snap — shape formula
        // dominates). World-space, spread-independent: the rendered branch
        // skeleton lines are fixed geometry and nodes must stay glued to them.
        const k = alpha * 0.8
        for (const node of simNodes) {
          const target = treesTargets.get(node.id)
          if (!target) continue
          node.vx += (target.x - node.x) * k
          node.vy += (target.y - node.y) * k
          node.vz += (target.z - node.z) * k
        }
      } else if (graphShape === 'tagboxes') {
        // Venn diagram force: pull strength varies by overlap zone
        const CONTAIN_K = 0.05
        for (const node of simNodes) {
          const target = tagBoxTargets.get(node.id)
          if (!target) continue
          const mc = target.matchedCount ?? 1
          let k: number
          if (mc === 0) k = alpha * 0.008
          else if (mc === 1) k = alpha * 0.012
          else if (mc === 2) k = alpha * 0.008
          else k = alpha * 0.004 / mc
          node.vx += (target.x - node.x) * k
          node.vy += (target.y - node.y) * k
          node.vz += (target.z - node.z) * k
          // AABB containment: push back if node escapes its assigned zone
          const box = target.assignedBox
          if (box && mc > 0) {
            if (node.x < box.cx - box.halfSizeX) node.vx += (box.cx - box.halfSizeX - node.x) * CONTAIN_K
            else if (node.x > box.cx + box.halfSizeX) node.vx += (box.cx + box.halfSizeX - node.x) * CONTAIN_K
            if (node.y < box.cy - box.halfSizeY) node.vy += (box.cy - box.halfSizeY - node.y) * CONTAIN_K
            else if (node.y > box.cy + box.halfSizeY) node.vy += (box.cy + box.halfSizeY - node.y) * CONTAIN_K
            if (node.z < box.cz - box.halfSizeZ) node.vz += (box.cz - box.halfSizeZ - node.z) * CONTAIN_K
            else if (node.z > box.cz + box.halfSizeZ) node.vz += (box.cz + box.halfSizeZ - node.z) * CONTAIN_K
          }
        }
      }
    }

    // Weaker charge for saturn/milkyway — shape formula dominates, forces add subtle jitter only
    const isShapeDriven = graphShape === 'sun' || graphShape === 'milkyway' || graphShape === 'saturn' || graphShape === 'brain' || graphShape === 'tagboxes' || graphShape === 'trees' || graphShape.startsWith('imported:')
    const chargeStrength = isShapeDriven ? 0 : -120
    const centerStrength = isShapeDriven ? 0 : 0.05

    // For 'natural': per-node charge based on tier — ultranodes/supernodes pulled harder to center
    const naturalChargeStrength = (d: unknown) => {
      const node = d as WorkerNode
      const tier = tierMap.get(node.id) ?? 'regular'
      if (tier === 'ultranode') return -350
      if (tier === 'supernode') return -200
      return -120
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulation = forceSimulation(simNodes as any, 3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('link', forceLink(simLinks as any).id((d: unknown) => (d as WorkerNode).id)
        .distance(graphShape === 'milkyway' ? 20 : 60)
        .strength(isShapeDriven ? 0 : 0.5))
      .force('charge', graphShape === 'natural'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? forceManyBody().strength(naturalChargeStrength as any)
        : forceManyBody().strength(chargeStrength))
      .force('center', forceCenter(0, 0, 0).strength(centerStrength))
      .force('collide', isShapeDriven ? null : forceCollide().radius((d: { id: string }) => tierRadius(d.id)))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('isolated', isolatedForce as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .force('shape', shapeForce as any)
      .alphaDecay(graphShape === 'natural' ? 0.055 : 0.07)
      .velocityDecay(0.45)
      .stop()

    // P1: announce node order + tiers once — all subsequent position updates are
    // bare Float32Array(3N) transfers aligned to this order
    post({
      type: 'nodeOrder',
      ids: simNodes.map(n => n.id),
      tiers: simNodes.map(n => tierMap.get(n.id) ?? 'regular'),
    })

    // ── Natural precalc: solve a degree-≥2 core silently, attach leaves/orphans
    // analytically, hand the renderer one final frame. 70% of vault nodes are
    // deg-≤1 and contribute nothing to cluster topology, but each costs O(log n)
    // in Barnes-Hut every tick — solving only the core cuts tick cost ~5×, and
    // skipping per-tick postMessage/render churn removes the settle-phase stutter
    // entirely. Graph3D's LERP_FACTOR glide animates the morph to the final frame,
    // same as the analytic shapes. Interactions (drag/reheat/filter/add/remove)
    // still stream per tick on the full simulation, exactly as before.
    function startNaturalPrecalc() {
      const gen = initGeneration
      tickRunning = true // defers moveNodes/reheat/filter runTick() starts until the final frame exists

      const coreIdSet = new Set<string>()
      for (const id of allNodeIds) {
        if ((degreeMap.get(id) ?? 0) >= 2 && find(id) === largestRoot) coreIdSet.add(id)
      }
      let coreNodes = simNodes.filter(n => coreIdSet.has(n.id))
      if (coreNodes.length < 50) {
        // degenerate/tiny vault — just solve everything silently
        coreNodes = simNodes
        for (const n of simNodes) coreIdSet.add(n.id)
      }
      const coreLinks: WorkerLink[] = (links ?? [])
        .filter(l => coreIdSet.has(l.source) && coreIdSet.has(l.target))
        .map(l => ({ source: l.source, target: l.target }))

      const PHASE2_COLLIDE_TICKS = 12
      const EST_TICKS = 70 // typical early-exit point; progress % is cosmetic
      let pTicks = 0

      const finishPrecalc = (wasm: ForceWasm | null) => {
        // BFS-attach: every unplaced node linked to a placed one sits beside it
        const placed = new Set(coreIdSet)
        const nodeById = new Map(simNodes.map(n => [n.id, n]))
        let frontier = allNodeIds.filter(id => !placed.has(id) && (adjacencyMap.get(id) ?? []).some(m => placed.has(m)))
        while (frontier.length > 0) {
          for (const id of frontier) {
            const anchorId = (adjacencyMap.get(id) ?? []).find(m => placed.has(m))
            const a = anchorId ? nodeById.get(anchorId) : undefined
            const n = nodeById.get(id)
            if (!a || !n) { placed.add(id); continue }
            const r = 45 + Math.random() * 35 // release baseline (v2.16.1) — flat leaf-attach radius
            const th = Math.random() * 2 * Math.PI
            const ph = Math.acos(2 * Math.random() - 1)
            n.x = (a.x ?? 0) + r * Math.sin(ph) * Math.cos(th)
            n.y = (a.y ?? 0) + r * Math.sin(ph) * Math.sin(th)
            n.z = (a.z ?? 0) + r * Math.cos(ph)
            placed.add(id)
          }
          frontier = allNodeIds.filter(id => !placed.has(id) && (adjacencyMap.get(id) ?? []).some(m => placed.has(m)))
        }
        // Isolated sub-clusters + orphans: central gaussian ball — the same
        // equilibrium isolatedForce(0.08) + repulsion settle into when simulated
        for (const id of allNodeIds) {
          if (placed.has(id)) continue
          const n = nodeById.get(id)
          if (!n) continue
          const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 110
          n.x = g(); n.y = g(); n.z = g()
        }
        post({ type: 'layoutProgress', pct: 97 })
        // Layout complete — snapshot it as the canonical BASE (no min-distance baked in;
        // this is what the layout cache persists), then bake the persisted per-tier
        // min-distance on top via the Rust collide polish. Keeping base and polish
        // separate makes the sliders reversible: every change re-polishes from base.
        captureBase()
        polishTieredFullSet(wasm, MINDIST_POLISH_ITERS)
        // Rest state; the full interactive simulation takes over from here
        for (const n of simNodes) { n.vx = 0; n.vy = 0; (n as WorkerNode & { vz?: number }).vz = 0 }
        simulation?.alpha(0)
        tickCount = pTicks
        tickRunning = false
        const positions = packPositions()
        const baseCopy = basePositions!.slice()
        post({ type: 'end', positions, basePositions: baseCopy, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer, baseCopy.buffer])
      }

      // ── WASM core path: one blocking solve off the main thread (~5× faster) ──
      const runCoreWasm = (wasm: ForceWasm) => {
        const n = coreNodes.length
        const idxOf = new Map(coreNodes.map((nd, i) => [nd.id, i]))
        // endpoints are still strings here (coreLinks never passed to d3 on this path)
        const lid = (e: string | WorkerNode) => (typeof e === 'string' ? e : e.id)
        const clinks = coreLinks.filter(l => idxOf.has(lid(l.source)) && idxOf.has(lid(l.target)))
        const m = clinks.length
        const posPtr = wasm.alloc(n * 3 * 4)
        const chargePtr = wasm.alloc(n * 4)
        const linksPtr = wasm.alloc(Math.max(1, m * 2) * 4)
        const pv = new Float32Array(wasm.memory.buffer, posPtr, n * 3)
        const cv = new Float32Array(wasm.memory.buffer, chargePtr, n)
        for (let i = 0; i < n; i++) {
          const nd = coreNodes[i]
          pv[i * 3] = nd.x ?? 0
          pv[i * 3 + 1] = nd.y ?? 0
          pv[i * 3 + 2] = (nd as WorkerNode & { z?: number }).z ?? 0
          cv[i] = naturalChargeStrength(nd)
        }
        if (m > 0) {
          const lv = new Uint32Array(wasm.memory.buffer, linksPtr, m * 2)
          for (let i = 0; i < m; i++) {
            lv[i * 2] = idxOf.get(lid(clinks[i].source))!
            lv[i * 2 + 1] = idxOf.get(lid(clinks[i].target))!
          }
        }
        post({ type: 'layoutProgress', pct: 40 })
        const packed = wasm.run_core(
          n, posPtr, chargePtr, m, linksPtr,
          60, 0.5, 1, 0.81, 0.05, 0.055, 0.45,
          MAX_TICKS, ALPHA_MIN, 0.5, 12, PHASE2_COLLIDE_TICKS,
        )
        pTicks = packed & 0xFFFF
        const out = new Float32Array(wasm.memory.buffer, posPtr, n * 3) // re-view: memory may have grown
        for (let i = 0; i < n; i++) {
          const nd = coreNodes[i]
          nd.x = out[i * 3]
          nd.y = out[i * 3 + 1]
          ;(nd as WorkerNode & { z?: number }).z = out[i * 3 + 2]
        }
        wasm.dealloc(posPtr, n * 3 * 4)
        wasm.dealloc(chargePtr, n * 4)
        wasm.dealloc(linksPtr, Math.max(1, m * 2) * 4)
      }

      // ── d3 fallback: chunked two-phase core sim (collide-free → collide tail) ──
      const runCoreD3 = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const coreSim = forceSimulation(coreNodes as any, 3)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .force('link', forceLink(coreLinks as any).id((d: unknown) => (d as WorkerNode).id).distance(60).strength(0.5))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .force('charge', forceManyBody().strength(naturalChargeStrength as any))
          .force('center', forceCenter(0, 0, 0).strength(0.05))
          .alphaDecay(0.055)
          .velocityDecay(0.45)
          .stop()
        let phase = 1
        let phase2Ticks = 0
        let pStable = 0
        const chunkLoop = () => {
          if (gen !== initGeneration) return // superseded by a newer init
          const sliceStart = performance.now()
          let done = false
          for (;;) {
            if (phase === 1) {
              if (pTicks >= MAX_TICKS || coreSim.alpha() < ALPHA_MIN) {
                phase = 2
                coreSim.force('collide', forceCollide().radius((d: { id: string }) => tierRadius(d.id)))
                continue
              }
              coreSim.tick()
              pTicks++
              let total = 0
              for (const n of coreNodes) {
                const vx = n.vx ?? 0, vy = n.vy ?? 0, vz = (n as WorkerNode & { vz?: number }).vz ?? 0
                total += Math.sqrt(vx * vx + vy * vy + vz * vz)
              }
              if (total / coreNodes.length < 0.5) {
                if (++pStable >= 3) {
                  phase = 2
                  coreSim.force('collide', forceCollide().radius((d: { id: string }) => tierRadius(d.id)))
                }
              } else pStable = 0
            } else {
              if (phase2Ticks >= PHASE2_COLLIDE_TICKS) { done = true; break }
              coreSim.tick()
              phase2Ticks++
              pTicks++
            }
            if (performance.now() - sliceStart > 250) break // yield so terminate/init messages stay responsive
          }
          const pct = done ? 96 : phase === 2
            ? Math.min(96, 88 + Math.round((phase2Ticks / PHASE2_COLLIDE_TICKS) * 8))
            : Math.min(87, Math.round((pTicks / EST_TICKS) * 87))
          post({ type: 'layoutProgress', pct })
          if (!done) { setTimeout(chunkLoop, 0); return }
          finishPrecalc(null)
        }
        setTimeout(chunkLoop, 0)
      }

      post({ type: 'layoutProgress', pct: 0 })
      loadForceWasm().then(wasm => {
        if (gen !== initGeneration) return // superseded while wasm loaded
        if (wasm) {
          console.log('[precalc-engine] wasm')
          runCoreWasm(wasm)
          if (gen !== initGeneration) return
          finishPrecalc(wasm)
        } else {
          console.log('[precalc-engine] d3-fallback')
          runCoreD3()
        }
      }).catch(() => {
        if (gen === initGeneration) runCoreD3()
      })
    }

    const initReason = (e.data as { reason?: 'shape' | 'data' }).reason ?? 'data'
    const warmCount = warmPositions.size > 0
      ? simNodes.reduce((c, n) => c + (warmPositions.has(n.id) ? 1 : 0), 0)
      : 0
    const warmCoverage = simNodes.length > 0 ? warmCount / simNodes.length : 0

    const allWarm = warmCount === simNodes.length && simNodes.length > 0
    if (graphShape === 'natural' && allWarm) {
      // Cache hit, no new nodes (reload / shape-switch back to natural / a few notes
      // removed): every node already sits at its cached position (simNodes were
      // initialised from warmPositions, which the hook guarantees is the natural
      // BASE layout — saved pre-polish). Emit the raw frame instantly, then bake the
      // persisted per-tier min-distance on top (applyMinDist posts a second, glided
      // frame) so the setting is visible at load without a precalc.
      console.log('[natural-layout] cache-hit: instant apply (no recompute)')
      naturalDisplaySpread = currentSpread
      for (const n of simNodes) { n.vx = 0; n.vy = 0; (n as WorkerNode & { vz?: number }).vz = 0 }
      tickCount = 0; stableFrameCount = 0; tickRunning = false
      captureBase()
      const positions = packPositions()
      const baseCopy = basePositions!.slice()
      post({ type: 'end', positions, basePositions: baseCopy, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer, baseCopy.buffer])
      applyMinDist(true)
    } else if (graphShape === 'natural' && (initReason === 'shape' || warmCoverage < 0.9)) {
      // Cold start or shape switch into natural → silent precalc + one-shot final frame.
      // The precalc geometry defines the baseline for this spread value; spread-adjust
      // scales relative to it.
      naturalDisplaySpread = currentSpread
      startNaturalPrecalc()
    } else if (graphShape === 'natural') {
      // Change-only (coverage ≥ 0.9): a few notes added/removed. Reuse every cached
      // position exactly and place each NEW node beside an already-placed linked
      // neighbour — analytically, with NO global sim. Running the full sim here would
      // pull the whole layout toward the sim equilibrium (collapse); analytic
      // placement keeps the existing shape identical and is instant.
      let newCount = 0
      for (const n of simNodes) {
        if (warmPositions.has(n.id)) continue
        newCount++
        const anchorId = (adjacencyMap.get(n.id) ?? []).find(id => warmPositions.has(id))
        const a = anchorId ? warmPositions.get(anchorId) : undefined
        if (a) {
          n.x = a.x + (Math.random() - 0.5) * 80
          n.y = a.y + (Math.random() - 0.5) * 80
          n.z = a.z + (Math.random() - 0.5) * 80
        }
        // unlinked new node (no placed neighbour): keep its init scatter near centre
      }
      console.log(`[natural-layout] change-only: ${newCount} new node(s) placed, ${warmCount} reused (no recompute)`)
      naturalDisplaySpread = currentSpread
      for (const n of simNodes) { n.vx = 0; n.vy = 0; (n as WorkerNode & { vz?: number }).vz = 0 }
      tickCount = 0; stableFrameCount = 0; tickRunning = false
      // Snapshot the merged layout (cached base + analytic placements) as the new base,
      // emit it raw, then bake the per-tier min-distance on top (second glided frame).
      captureBase()
      const positions = packPositions()
      const baseCopy = basePositions!.slice()
      post({ type: 'end', positions, basePositions: baseCopy, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer, baseCopy.buffer])
      applyMinDist(true)
    } else {
      runTick()
    }
  } else if (type === 'setSpread') {
    const spread = (e.data as { spread?: number }).spread ?? 1.0

    // Natural: spread is a pure geometric zoom of the precalc'd layout. Scale every
    // coordinate by (spread / naturalDisplaySpread) around the centre of gravity and
    // hand the renderer one frame — Graph3D's LERP glide animates it like pinch-zoom.
    // No simulation runs, so this is O(n) (microseconds), not a multi-second resettle.
    if (graphShape === 'natural') {
      const ratio = naturalDisplaySpread > 0 ? spread / naturalDisplaySpread : 1
      currentSpread = spread
      naturalDisplaySpread = spread
      if (Number.isFinite(ratio) && Math.abs(ratio - 1) > 1e-4 && simNodes.length > 0) {
        // centre of gravity
        let cx = 0, cy = 0, cz = 0
        for (const n of simNodes) { cx += n.x; cy += n.y; cz += (n as WorkerNode & { z?: number }).z ?? 0 }
        cx /= simNodes.length; cy /= simNodes.length; cz /= simNodes.length
        for (const n of simNodes) {
          n.x = cx + (n.x - cx) * ratio
          n.y = cy + (n.y - cy) * ratio
          const nz = (n as WorkerNode & { z?: number }).z ?? 0
          ;(n as WorkerNode & { z?: number }).z = cz + (nz - cz) * ratio
          n.vx = 0; n.vy = 0; (n as WorkerNode & { vz?: number }).vz = 0
        }
        // Scale the min-distance BASE layout identically (around its own centroid) so a
        // later applyMinDist() re-polish works in the new scale, not the pre-zoom one.
        if (basePositions && basePositions.length === simNodes.length * 3) {
          const b = basePositions
          const m = simNodes.length
          let bx = 0, by = 0, bz = 0
          for (let i = 0; i < m; i++) { bx += b[i * 3]; by += b[i * 3 + 1]; bz += b[i * 3 + 2] }
          bx /= m; by /= m; bz /= m
          for (let i = 0; i < m; i++) {
            b[i * 3] = bx + (b[i * 3] - bx) * ratio
            b[i * 3 + 1] = by + (b[i * 3 + 1] - by) * ratio
            b[i * 3 + 2] = bz + (b[i * 3 + 2] - bz) * ratio
          }
        }
        // Keep the interactive sim's rest lengths/charge consistent with the new scale
        // so a later drag/reheat doesn't pull the graph back toward the base scale.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lf = simulation?.force('link') as any
        if (lf?.distance) lf.distance(60 * spread)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cf = simulation?.force('charge') as any
        if (cf?.strength) {
          cf.strength((d: unknown) => naturalChargeStrengthBase(d) * Math.sqrt(spread))
        }
      }
      tickCount = 0; stableFrameCount = 0
      const t0 = performance.now()
      const positions = packPositions()
      post({ type: 'end', positions, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer])
      console.log(`[spread-scale] zoom ratio=${ratio.toFixed(3)} compute=${(performance.now() - t0).toFixed(2)}ms n=${simNodes.length}`)
      return
    }

    currentSpread = spread  // shape targets scale with spread
    // Trees: spread rescales each tree about its own base point on the plane —
    // taller from the same base, branches and leaves proportionally wider
    if (graphShape === 'trees') {
      applyTreesSpread(spread)
      self.postMessage({ type: 'treeBranches', treeBranches: treeBranchesList, treeLabels: treeLabelsList })
    }
    if (simulation) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lf = simulation.force('link') as any
      if (lf?.distance) lf.distance(60 * spread)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cf = simulation.force('charge') as any
      const baseCharge = (graphShape === 'sun' || graphShape === 'milkyway' || graphShape === 'saturn' || graphShape === 'brain' || graphShape === 'tagboxes' || graphShape === 'trees' || graphShape.startsWith('imported:')) ? 0 : -120
      if (cf?.strength) {
        cf.strength(baseCharge * spread)
      }
      tickCount = 0; stableFrameCount = 0
      simulation.alpha(0.3)
      if (!tickRunning) runTick()
    }
  } else if (type === 'applyPositions') {
    // Reset All / cache restore: snap nodes to the given cached positions and emit
    // one frame — no simulation, no recompute. Positions are matched by id, so a
    // stale cache (missing/extra ids) degrades gracefully (unmatched nodes keep
    // their current spot).
    const data = e.data as { ids?: string[]; positions?: Float32Array; spread?: number }
    if (data.ids && data.positions && simulation) {
      const posByIndex = new Map<string, number>()
      data.ids.forEach((id, i) => posByIndex.set(id, i))
      const arr = data.positions
      for (const n of simNodes) {
        const i = posByIndex.get(n.id)
        if (i !== undefined && i * 3 + 2 < arr.length) {
          n.x = arr[i * 3]; n.y = arr[i * 3 + 1]
          ;(n as WorkerNode & { z?: number }).z = arr[i * 3 + 2]
        }
        n.vx = 0; n.vy = 0; (n as WorkerNode & { vz?: number }).vz = 0
      }
      // The applied positions become the spread baseline (subsequent spread-adjust
      // scales relative to this), keeping the spread slider and geometry in sync.
      if (typeof data.spread === 'number') { naturalDisplaySpread = data.spread; currentSpread = data.spread }
      console.log('[natural-layout] applyPositions: restored cached layout (no recompute)')
      simulation.alpha(0)
      tickCount = 0; stableFrameCount = 0; tickRunning = false
      // Restored cache = the BASE layout; show it, then re-bake the current min-distance
      // on top (second glided frame) so Reset All honours the sliders too.
      captureBase()
      const positions = packPositions()
      post({ type: 'end', positions, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer])
      if (graphShape === 'natural') applyMinDist(true)
    }
  } else if (type === 'reheat') {
    // Natural: a full-sim reheat would collapse the precalc layout. Keep the layout
    // and just re-emit it (resolves simDone). Other shapes reheat as before.
    if (graphShape === 'natural') {
      const positions = packPositions()
      post({ type: 'end', positions, tickCount, tagBoxes: tagBoxesList, timestamp: performance.now() }, [positions.buffer])
    } else if (simulation) {
      tickCount = 0; stableFrameCount = 0
      simulation.alpha(0.3)
      if (!tickRunning) runTick()
    }
  } else if (type === 'setShapeMotion') {
    shapeMotion = !!(e.data as { enabled?: boolean }).enabled
    if (shapeMotion && shapeMotionActive()) {
      tickCount = 0
      stableFrameCount = 0
      simulation?.alpha(0.3)
      if (!tickRunning) runTick()
    }
  } else if (type === 'setMinDist') {
    // Per-tier minimum node distance (collide radius) from the UI sliders.
    // Natural: applied like Spread — a pure transform of the precalc'd BASE layout
    // (restore base coords → per-tier collide polish in Rust → ONE glided frame).
    // NOTE the old path re-ticked the full interactive sim (~2s for 10.5k nodes) and
    // was a no-op anyway: d3's forceCollide caches per-node radii at initialize(),
    // so "live" tierRadius reads never reached the collide force.
    // Non-natural shapes have no collide force (shape formula dominates); the drag
    // PBD (separateDragNodes/solveDragRelax) reads the updated values live.
    const d = e.data as { regular?: number; super?: number; ultra?: number }
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
    const changed = (num(d.regular) && d.regular !== MIN_DIST_REGULAR)
      || (num(d.super) && d.super !== MIN_DIST_SUPER)
      || (num(d.ultra) && d.ultra !== MIN_DIST_ULTRA)
    if (num(d.regular)) MIN_DIST_REGULAR = d.regular
    if (num(d.super)) MIN_DIST_SUPER = d.super
    if (num(d.ultra)) MIN_DIST_ULTRA = d.ultra
    // Unchanged values (e.g. the UI re-sending persisted settings on mount, when the
    // init/precalc already baked them) — skip the re-polish entirely.
    if (changed && graphShape === 'natural') applyMinDist(true)
  } else if (type === 'setFilter') {
    // Natural keeps its fixed precalc/cached layout — a recenter-reheat would
    // collapse it. Visibility is applied by the renderer, not the layout.
    if (graphShape === 'natural') return
    const visibleIds = new Set((e.data as { visibleIds?: string[] }).visibleIds ?? [])
    if (simulation && visibleIds.size > 0) {
      let cx = 0, cy = 0, cz = 0, cnt = 0
      for (const node of simNodes) {
        if (visibleIds.has(node.id)) { cx += node.x; cy += node.y; cz += node.z; cnt++ }
      }
      if (cnt > 0) { cx /= cnt; cy /= cnt; cz /= cnt }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cf = simulation.force('center') as any
      if (cf?.x) { cf.x(cx); cf.y(cy); cf.z(cz) }
      tickCount = 0; stableFrameCount = 0
      simulation.alpha(0.3)
      if (!tickRunning) runTick()
    }
  } else if (type === 'stop') {
    if (simulation) simulation.stop()
    tickRunning = false
  }
}
