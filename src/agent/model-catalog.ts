/**
 * Model catalog client/cache (VCL-R3-027).
 *
 * Model discovery previously hit the live network on every call, which made
 * unit paths slow and required network access in tests. A ModelCatalog wraps
 * the model fetcher with an injectable implementation and an in-process TTL
 * cache, so tests can run offline with a fake fetcher and production callers
 * get fast repeated lookups.
 */

import { listModels } from '../lib/api.js';
import type { Model } from '../types/index.js';

export type ModelFetcher = (options?: { showSpinner?: boolean }) => Promise<Model[]>;

export interface ModelCatalogOptions {
  /** Model source. Defaults to the live Venice `listModels` API. */
  fetcher?: ModelFetcher;
  /** Cache freshness window in milliseconds. */
  ttlMs?: number;
}

export class ModelCatalog {
  private readonly fetcher: ModelFetcher;
  private readonly ttlMs: number;
  private cache?: { models: Model[]; fetchedAt: number };
  private inflight?: Promise<Model[]>;

  constructor(options: ModelCatalogOptions = {}) {
    this.fetcher = options.fetcher ?? listModels;
    this.ttlMs = options.ttlMs ?? 60_000;
  }

  /**
   * Return the model list, using the cached copy when it is still fresh.
   * Concurrent callers share a single in-flight fetch.
   */
  async listModels(force = false): Promise<Model[]> {
    if (!force && this.cache && Date.now() - this.cache.fetchedAt < this.ttlMs) {
      return [...this.cache.models];
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.fetcher({ showSpinner: false })
      .then((models) => {
        this.cache = { models, fetchedAt: Date.now() };
        return models;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  /** Find a model by id, bypassing the cache when `force` is set. */
  async find(id: string, force = false): Promise<Model | undefined> {
    const models = await this.listModels(force);
    return models.find((model) => model.id === id);
  }

  /** Drop the cache so the next lookup refetches. */
  clear(): void {
    this.cache = undefined;
  }
}

export { listModels };
