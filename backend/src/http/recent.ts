/**
 * Counts events per key over a sliding window, in memory (one API process; a restart forgets).
 * Used for every "at most N an hour" rule. Old entries are swept, and the number of keys has a
 * ceiling, so keys an attacker makes up (random board ids, numbers) cannot fill the memory: past
 * it, the oldest keys are forgotten first.
 */
export class RecentCounter {
  private readonly times = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** How many events `key` had in the window. */
  count(key: string): number {
    return this.recent(key).length;
  }

  add(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    // Re-inserted, so the map's order stays oldest-used first.
    this.times.delete(key);
    this.times.set(key, list);
    if (this.times.size > this.maxKeys) this.sweep();
  }

  get size(): number {
    return this.times.size;
  }

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    return (this.times.get(key) ?? []).filter((time) => time > since);
  }

  private sweep(): void {
    const since = this.now() - this.windowMs;
    for (const [key, list] of this.times) if (!list.some((time) => time > since)) this.times.delete(key);
    for (const key of this.times.keys()) {
      if (this.times.size <= this.maxKeys) break;
      this.times.delete(key);
    }
  }
}
