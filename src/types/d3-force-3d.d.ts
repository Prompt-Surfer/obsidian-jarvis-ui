declare module 'd3-force-3d' {
  export interface SimulationNode {
    id?: string
    x?: number
    y?: number
    z?: number
    vx?: number
    vy?: number
    vz?: number
    fx?: number | null
    fy?: number | null
    fz?: number | null
  }

  export interface SimulationLink<N extends SimulationNode = SimulationNode> {
    source: string | N
    target: string | N
  }

  export interface Simulation<N extends SimulationNode = SimulationNode> {
    nodes(): N[]
    nodes(nodes: N[]): this
    alpha(): number
    alpha(alpha: number): this
    alphaMin(): number
    alphaMin(min: number): this
    alphaDecay(): number
    alphaDecay(decay: number): this
    alphaTarget(): number
    alphaTarget(target: number): this
    velocityDecay(): number
    velocityDecay(decay: number): this
    force(name: string): Force<N> | undefined
    force(name: string, force: Force<N> | null): this
    tick(iterations?: number): this
    restart(): this
    stop(): this
    on(typenames: string, listener: (this: this) => void): this
    on(typenames: string): (this: this) => void
    find(x: number, y: number, z?: number, radius?: number): N | undefined
  }

  export interface Force<N extends SimulationNode = SimulationNode> {
    (alpha: number): void
    initialize?: (nodes: N[], random: () => number) => void
  }

  export interface LinkForce<N extends SimulationNode = SimulationNode, L extends SimulationLink<N> = SimulationLink<N>> extends Force<N> {
    links(): L[]
    links(links: L[]): this
    id(): (node: N) => string | number
    id(id: (node: N) => string | number): this
    iterations(): number
    iterations(iterations: number): this
    distance(): number | ((link: L, i: number, links: L[]) => number)
    distance(distance: number | ((link: L, i: number, links: L[]) => number)): this
    strength(): number | ((link: L, i: number, links: L[]) => number)
    strength(strength: number | ((link: L, i: number, links: L[]) => number)): this
  }

  export interface ManyBodyForce<N extends SimulationNode = SimulationNode> extends Force<N> {
    strength(): number | ((node: N, i: number, nodes: N[]) => number)
    strength(strength: number | ((node: N, i: number, nodes: N[]) => number)): this
    theta(): number
    theta(theta: number): this
    distanceMin(): number
    distanceMin(distance: number): this
    distanceMax(): number
    distanceMax(distance: number): this
  }

  export interface CenterForce<N extends SimulationNode = SimulationNode> extends Force<N> {
    x(): number
    x(x: number): this
    y(): number
    y(y: number): this
    z(): number
    z(z: number): this
    strength(): number
    strength(strength: number): this
  }

  export interface CollideForce<N extends SimulationNode = SimulationNode> extends Force<N> {
    radius(): number | ((node: N, i: number, nodes: N[]) => number)
    radius(radius: number | ((node: N, i: number, nodes: N[]) => number)): this
    strength(): number
    strength(strength: number): this
    iterations(): number
    iterations(iterations: number): this
  }

  export function forceSimulation<N extends SimulationNode = SimulationNode>(nodes?: N[], numDimensions?: number): Simulation<N>
  export function forceLink<N extends SimulationNode = SimulationNode, L extends SimulationLink<N> = SimulationLink<N>>(links?: L[]): LinkForce<N, L>
  export function forceManyBody<N extends SimulationNode = SimulationNode>(): ManyBodyForce<N>
  export function forceCenter<N extends SimulationNode = SimulationNode>(x?: number, y?: number, z?: number): CenterForce<N>
  export function forceCollide<N extends SimulationNode = SimulationNode>(radius?: number | ((node: N, i: number, nodes: N[]) => number)): CollideForce<N>
  export function forceX<N extends SimulationNode = SimulationNode>(x?: number | ((node: N, i: number, nodes: N[]) => number)): Force<N>
  export function forceY<N extends SimulationNode = SimulationNode>(y?: number | ((node: N, i: number, nodes: N[]) => number)): Force<N>
  export function forceZ<N extends SimulationNode = SimulationNode>(z?: number | ((node: N, i: number, nodes: N[]) => number)): Force<N>
}
