import { apiRequest } from './api.js';

export type BillingCurrency = 'USD' | 'DIEM' | 'BUNDLED_CREDITS';

export interface BillingBalance {
  canConsume: boolean;
  consumptionCurrency: BillingCurrency | 'VCU' | null;
  balances: {
    diem: number | null;
    usd: number | null;
  };
  diemEpochAllocation: number;
}

export interface BillingUsageEntry {
  amount: number;
  currency: BillingCurrency;
  inferenceDetails: {
    completionTokens: number | null;
    inferenceExecutionTime: number | null;
    promptTokens: number | null;
    requestId: string;
  } | null;
  notes: string;
  pricePerUnitUsd: number;
  sku: string;
  timestamp: string;
  units: number;
}

export type ConsumptionLimits = {
  usd?: number | null;
  diem?: number | null;
};

export interface ApiKeyMetadata {
  apiKeyType: 'INFERENCE' | 'ADMIN';
  consumptionLimits: ConsumptionLimits;
  limitPeriod: 'EPOCH' | 'MONTH' | 'LIFETIME';
  createdAt: string | null;
  description?: string;
  expiresAt: string | null;
  id: string;
  last6Chars: string;
  lastUsedAt: string | null;
  usage?: {
    trailingSevenDays: {
      usd: string;
      diem: string;
    };
  };
  currentPeriodUsage?: {
    usd: string;
    diem: string;
  };
}

export interface ApiKeyRateLimits {
  accessPermitted: boolean;
  apiTier: {
    id: string;
    isCharged: boolean;
  };
  balances: {
    USD: number;
    DIEM: number;
  };
  keyExpiration: string | null;
  nextEpochBegins: string;
  rateLimits: Array<{
    apiModelId?: string;
    rateLimits: Array<{
      amount: number;
      type: string;
    }>;
  }>;
}

const API_KEY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertApiKeyId(id: string): void {
  if (!API_KEY_ID_PATTERN.test(id)) {
    throw new Error(
      'Invalid API key ID. Use the UUID shown by "venice keys list", not the API key secret.'
    );
  }
}

export async function getBillingBalance(): Promise<BillingBalance> {
  return apiRequest<BillingBalance>('/billing/balance', {
    spinnerText: 'Fetching balance...',
  });
}

export async function getBillingUsage(options: {
  startTimestamp: string;
  endTimestamp: string;
  currency?: BillingCurrency;
  pageSize?: number;
}): Promise<BillingUsageEntry[]> {
  const entries: BillingUsageEntry[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams();
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error('Usage history returned a repeated cursor; refusing to loop indefinitely.');
      }
      seenCursors.add(cursor);
      params.set('cursor', cursor);
    } else {
      params.set('startTimestamp', options.startTimestamp);
      params.set('endTimestamp', options.endTimestamp);
      if (options.currency) params.set('currency', options.currency);
      if (options.pageSize) params.set('pageSize', String(options.pageSize));
    }

    const response: {
      data: BillingUsageEntry[];
      nextCursor: string | null;
    } = await apiRequest(`/billing/usage-history?${params.toString()}`, {
      spinnerText: cursor ? 'Fetching more usage...' : 'Fetching billed usage...',
    });

    entries.push(...response.data);
    cursor = response.nextCursor;
  } while (cursor);

  return entries;
}

export async function getBillingAnalytics(lookback: string): Promise<unknown> {
  const params = new URLSearchParams({ lookback });
  return apiRequest(`/billing/usage-analytics?${params.toString()}`, {
    spinnerText: 'Fetching usage analytics...',
  });
}

export async function listApiKeys(): Promise<ApiKeyMetadata[]> {
  const response = await apiRequest<{ data: ApiKeyMetadata[] }>('/api_keys', {
    spinnerText: 'Fetching API keys...',
  });
  return response.data;
}

export async function createApiKey(input: {
  apiKeyType: 'INFERENCE' | 'ADMIN';
  description: string;
  expiresAt?: string;
  consumptionLimit?: ConsumptionLimits;
  limitPeriod?: 'EPOCH' | 'MONTH' | 'LIFETIME';
}): Promise<ApiKeyMetadata & { apiKey: string }> {
  const response = await apiRequest<{
    data: ApiKeyMetadata & { apiKey: string };
  }>('/api_keys', {
    method: 'POST',
    body: input,
    spinnerText: 'Creating API key...',
    retries: 0,
  });
  return response.data;
}

export async function deleteApiKey(id: string): Promise<void> {
  assertApiKeyId(id);
  const params = new URLSearchParams({ id });
  const response = await apiRequest<{ success: boolean }>(`/api_keys?${params.toString()}`, {
    method: 'DELETE',
    spinnerText: 'Deleting API key...',
    retries: 0,
  });
  if (!response.success) {
    throw new Error('Venice did not confirm API key deletion.');
  }
}

export async function getApiKey(id: string): Promise<ApiKeyMetadata> {
  assertApiKeyId(id);
  const response = await apiRequest<{ data: ApiKeyMetadata }>(`/api_keys/${id}`, {
    spinnerText: 'Fetching API key...',
  });
  return response.data;
}

export async function updateApiKey(input: {
  id: string;
  description?: string;
  expiresAt?: string | null;
  consumptionLimit?: ConsumptionLimits;
  limitPeriod?: 'EPOCH' | 'MONTH' | 'LIFETIME';
}): Promise<ApiKeyMetadata> {
  assertApiKeyId(input.id);
  const body: Record<string, unknown> = { id: input.id };
  if (input.description !== undefined) body.description = input.description;
  if (input.expiresAt !== undefined) body.expiresAt = input.expiresAt;
  if (input.consumptionLimit !== undefined) body.consumptionLimit = input.consumptionLimit;
  if (input.limitPeriod !== undefined) body.limitPeriod = input.limitPeriod;
  const response = await apiRequest<{ data: ApiKeyMetadata }>('/api_keys', {
    method: 'PATCH',
    body,
    spinnerText: 'Updating API key...',
    retries: 0,
  });
  return response.data;
}

export interface ApiKeyRateLimitLogEntry {
  apiKeyId: string;
  modelId: string;
  rateLimitTier: string;
  rateLimitType: 'RPD' | 'RPM' | 'TPM' | 'FAILED_REQUESTS' | 'UNSUPPORTED_FEATURE_REQUESTS' | string;
  timestamp: string;
}

export async function getApiKeyRateLimitLogs(): Promise<ApiKeyRateLimitLogEntry[]> {
  const response = await apiRequest<{ data: ApiKeyRateLimitLogEntry[] }>('/api_keys/rate_limits/log', {
    spinnerText: 'Fetching rate limit log...',
  });
  return response.data;
}

export async function getWeb3KeyToken(): Promise<string> {
  const response = await apiRequest<{ data: { token: string } }>('/api_keys/generate_web3_key', {
    spinnerText: 'Requesting web3 signing token...',
    authenticated: false,
    retries: 0,
  });
  return response.data.token;
}

export async function createWeb3ApiKey(input: {
  apiKeyType: 'INFERENCE' | 'ADMIN';
  address: string;
  signature: string;
  token: string;
  description: string;
  expiresAt?: string;
  consumptionLimit?: ConsumptionLimits;
  limitPeriod?: 'EPOCH' | 'MONTH' | 'LIFETIME';
}): Promise<ApiKeyMetadata & { apiKey: string }> {
  const response = await apiRequest<{
    data: ApiKeyMetadata & { apiKey: string };
  }>('/api_keys/generate_web3_key', {
    method: 'POST',
    body: input,
    spinnerText: 'Minting web3 API key...',
    authenticated: false,
    retries: 0,
  });
  return response.data;
}

export async function getApiKeyRateLimits(): Promise<ApiKeyRateLimits> {
  const response = await apiRequest<{ data: ApiKeyRateLimits }>('/api_keys/rate_limits', {
    spinnerText: 'Fetching rate limits...',
  });
  return response.data;
}
