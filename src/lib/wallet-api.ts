import { apiRequest } from './api.js';

export interface X402Balance {
  walletAddress: string;
  balanceUsd: number;
  canConsume: boolean;
  minimumTopUpUsd: number;
  suggestedTopUpUsd: number;
  diemBalanceUsd?: number;
}

export interface X402Transaction {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  createdAt: string;
  requestId: string | null;
  modelId: string | null;
}

export interface X402TransactionPage {
  walletAddress: string;
  currentBalance: number;
  transactions: X402Transaction[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Fetch the current x402 USDC credit balance for a wallet.
 * Requires SIGN-IN-WITH-X wallet authentication (the CLI sends it
 * automatically when signInWithX is configured).
 */
export async function getX402Balance(walletAddress: string): Promise<X402Balance> {
  const response = await apiRequest<{ data: X402Balance }>(
    `/x402/balance/${encodeURIComponent(walletAddress)}`,
    {
      spinnerText: 'Fetching x402 wallet balance...',
    }
  );
  return response.data;
}

/**
 * Fetch paginated x402 transaction history for a wallet.
 * Requires SIGN-IN-WITH-X wallet authentication.
 */
export async function getX402Transactions(
  walletAddress: string,
  options: { limit?: number; offset?: number } = {}
): Promise<X402TransactionPage> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  const query = params.toString();
  const response = await apiRequest<{ data: X402TransactionPage }>(
    `/x402/transactions/${encodeURIComponent(walletAddress)}${query ? `?${query}` : ''}`,
    {
      spinnerText: 'Fetching x402 wallet transactions...',
    }
  );
  return response.data;
}

/** One accepted payment option returned by the top-up probe (swagger `accepts` entry). */
export interface X402PaymentRequirement {
  scheme: string;
  /** CAIP-2 network id, e.g. `eip155:8453` (Base) or `solana:5eykt…` (Solana mainnet). */
  network: string;
  /** Minimum payment amount in base units (USDC has 6 decimals). */
  amount: string;
  /** USDC token address or mint for the selected network. */
  asset: string;
  /** Receiver wallet address. */
  payTo: string;
  maxTimeoutSeconds: number;
  /** Network-specific metadata (e.g. a Solana feePayer). */
  extra?: Record<string, unknown>;
}

/** Payment requirements returned by POST /x402/top-up with no payment header (HTTP 402). */
export interface X402TopUpRequirements {
  x402Version: number;
  accepts: X402PaymentRequirement[];
}

/** Result of a successful top-up submission (HTTP 200). */
export interface X402TopUpResult {
  walletAddress: string;
  amountCredited: number;
  newBalance: number;
  paymentId: string;
}

/**
 * Probe x402 top-up payment requirements. The endpoint is unauthenticated
 * (`security: []`) and answers 402 with the payment options — the CLI treats
 * that 402 as data, not an error (guided top-up flow).
 */
export async function probeTopUpRequirements(): Promise<X402TopUpRequirements> {
  return apiRequest<X402TopUpRequirements>('/x402/top-up', {
    method: 'POST',
    body: {},
    spinnerText: 'Fetching x402 payment requirements...',
    authenticated: false,
    allowedStatuses: [402],
  });
}

/**
 * Submit a signed x402 payment header (`PAYMENT-SIGNATURE`) to credit the
 * wallet balance. Unauthenticated — the signature is the credential.
 */
export async function submitTopUp(paymentSignature: string): Promise<X402TopUpResult> {
  const response = await apiRequest<{ success: true; data: X402TopUpResult }>('/x402/top-up', {
    method: 'POST',
    body: {},
    spinnerText: 'Submitting x402 payment...',
    authenticated: false,
    additionalHeaders: { 'PAYMENT-SIGNATURE': paymentSignature },
  });
  return response.data;
}
