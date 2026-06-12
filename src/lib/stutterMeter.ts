// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Prompt-Surfer (https://github.com/Prompt-Surfer)

/**
 * Stutter measurement harness — quantifies main-thread frame-pacing jank.
 *
 * Average FPS hides stutter: a capture averaging 58fps can still hitch visibly
 * if a handful of frames take 80–200ms (GC pauses, worker-message
 * deserialisation, O(n) React effects). Stutter lives in the tail of the
 * frame-interval distribution, so this reports percentiles, long-frame counts
 * and long tasks — not averages.
 *
 * Usage from the browser console or Playwright `page.evaluate`:
 *   __stutter.start()
 *   ... interact: switch pattern, drag nodes ...
 *   const report = __stutter.stop()
 *
 * The meter runs its own requestAnimationFrame loop, so it observes true rAF
 * cadence independent of Graph3D's dirty-flag render gate. Anything that
 * blocks the main thread (long task, GC, layout) stretches the gap between
 * rAF callbacks and shows up here, even when the WebGL render itself is fast.
 */

export interface StutterReport {
  durationMs: number
  frames: number
  avgFps: number
  /** Estimated display refresh interval (median frame interval), ms */
  baselineMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  /** Intervals > 1.5× baseline — each one is at least one visibly dropped frame */
  longFrames: number
  /** Intervals > 50ms — visible hitches */
  severeFrames: number
  /** % of wall time spent beyond baseline inside long frames (the "felt" stutter) */
  stutterTimePct: number
  /** Long tasks (>50ms) observed on the main thread during capture */
  longTasks: { count: number; totalMs: number; maxMs: number }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

export class StutterMeter {
  private intervals: number[] = []
  private rafId = 0
  private running = false
  private startTs = 0
  private lastTs = 0
  private ltCount = 0
  private ltTotalMs = 0
  private ltMaxMs = 0
  private observer: PerformanceObserver | null = null

  start(): void {
    if (this.running) this.stop()
    this.running = true
    this.intervals = []
    this.ltCount = 0
    this.ltTotalMs = 0
    this.ltMaxMs = 0
    this.startTs = performance.now()
    this.lastTs = 0

    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.ltCount++
          this.ltTotalMs += entry.duration
          if (entry.duration > this.ltMaxMs) this.ltMaxMs = entry.duration
        }
      })
      this.observer.observe({ entryTypes: ['longtask'] })
    } catch {
      this.observer = null // 'longtask' unsupported (Safari/Firefox) — rAF gaps still captured
    }

    const tick = (ts: number) => {
      if (!this.running) return
      if (this.lastTs > 0) this.intervals.push(ts - this.lastTs)
      this.lastTs = ts
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): StutterReport {
    const durationMs = performance.now() - this.startTs
    this.running = false
    cancelAnimationFrame(this.rafId)
    this.observer?.disconnect()
    this.observer = null

    const sorted = [...this.intervals].sort((a, b) => a - b)
    const frames = sorted.length
    const baselineMs = percentile(sorted, 50) || 16.7
    const longThreshold = baselineMs * 1.5
    let longFrames = 0
    let severeFrames = 0
    let stutterTime = 0
    let sum = 0
    for (const dt of this.intervals) {
      sum += dt
      if (dt > longThreshold) {
        longFrames++
        stutterTime += dt - baselineMs
      }
      if (dt > 50) severeFrames++
    }

    return {
      durationMs: Math.round(durationMs),
      frames,
      avgFps: durationMs > 0 ? Math.round((frames / durationMs) * 1000) : 0,
      baselineMs: round1(baselineMs),
      meanMs: round1(frames > 0 ? sum / frames : 0),
      p50Ms: round1(percentile(sorted, 50)),
      p95Ms: round1(percentile(sorted, 95)),
      p99Ms: round1(percentile(sorted, 99)),
      maxMs: round1(sorted[frames - 1] ?? 0),
      longFrames,
      severeFrames,
      stutterTimePct: round1(durationMs > 0 ? (stutterTime / durationMs) * 100 : 0),
      longTasks: {
        count: this.ltCount,
        totalMs: Math.round(this.ltTotalMs),
        maxMs: Math.round(this.ltMaxMs),
      },
    }
  }

  isRunning(): boolean {
    return this.running
  }
}

declare global {
  interface Window {
    __stutter: StutterMeter
  }
}

if (typeof window !== 'undefined') {
  window.__stutter = new StutterMeter()
}
