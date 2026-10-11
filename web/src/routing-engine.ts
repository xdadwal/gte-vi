import type { Fix, Refuge } from "./model";
import type { Zone } from "./routing";
export type WalkingRoute = {
  coordinates: [number, number][];
  distance: number;
  insideDistance: number;
  refuge: Refuge;
  graphVersion: string;
};
export type RoutingRequest = {
  origin: Fix;
  refuges: Refuge[];
  zones: Zone[];
  now: number;
};
export interface RoutingEngine {
  route(request: RoutingRequest): Promise<WalkingRoute>;
  dispose(): void;
}
export class BrowserRoutingEngine implements RoutingEngine {
  private worker: Worker | null = null;
  private generation = 0;
  private reject: ((error: Error) => void) | null = null;
  route(request: RoutingRequest): Promise<WalkingRoute> {
    if (this.reject) this.dispose();
    this.worker ??= new Worker(
      new URL("./routing.worker.ts", import.meta.url),
      { type: "module" },
    );
    const id = ++this.generation,
      worker = this.worker;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      worker.onmessage = (event) => {
        if (event.data.id !== id) return;
        this.reject = null;
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.route);
      };
      worker.onerror = () => {
        this.reject = null;
        worker.terminate();
        this.worker = null;
        reject(new Error("Walking route calculation failed. Please retry."));
      };
      worker.postMessage({ ...request, id });
    });
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.reject?.(new Error("Route calculation cancelled"));
    this.reject = null;
  }
}
