import { Command } from 'commander';
import {
  getX402Balance,
  getX402Transactions,
  probeTopUpRequirements,
  submitTopUp,
  type X402PaymentRequirement,
} from '../lib/wallet-api.js';
import {
  detectOutputFormat,
  formatTable,
  getChalk,
} from '../lib/output.js';

const DEFAULT_WALLET_DESCRIPTION =
  'x402 wallet balance, transaction history, and guided top-up (requires SIGN-IN-WITH-X wallet authentication)';

export function registerWalletCommand(program: Command): void {
  const wallet = program
    .command('wallet')
    .description(DEFAULT_WALLET_DESCRIPTION);

  wallet
    .command('balance <address>')
    .description('Show the x402 USDC credit balance for a wallet')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (address: string, options) => {
      const balance = await getX402Balance(address.trim());
      if (detectOutputFormat(options.format) === 'json') {
        console.log(JSON.stringify(balance, null, 2));
        return;
      }

      const c = getChalk();
      console.log(`Wallet: ${balance.walletAddress}`);
      console.log(`Balance: ${c.bold(`$${balance.balanceUsd.toFixed(6)}`)}`);
      console.log(`Can consume: ${balance.canConsume ? c.green('yes') : c.red('no')}`);
      console.log(`Minimum top-up: $${balance.minimumTopUpUsd}`);
      console.log(`Suggested top-up: $${balance.suggestedTopUpUsd}`);
      if (balance.diemBalanceUsd !== undefined) {
        console.log(`DIEM balance (linked account): $${balance.diemBalanceUsd}`);
      }
    });

  wallet
    .command('transactions <address>')
    .description('Show paginated x402 transaction history for a wallet')
    .option('--limit <number>', 'Maximum number of transactions to return')
    .option('--offset <number>', 'Number of transactions to skip')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (address: string, options) => {
      const page = await getX402Transactions(address.trim(), {
        ...(options.limit !== undefined ? { limit: parsePositiveInt(options.limit, 'limit') } : {}),
        ...(options.offset !== undefined ? { offset: parseNonNegativeInt(options.offset, 'offset') } : {}),
      });
      if (detectOutputFormat(options.format) === 'json') {
        console.log(JSON.stringify(page, null, 2));
        return;
      }

      if (page.transactions.length === 0) {
        console.log(getChalk().dim('No x402 transactions yet.'));
        return;
      }

      console.log(`Wallet: ${page.walletAddress}`);
      console.log(`Current balance: $${page.currentBalance.toFixed(6)}`);
      console.log(formatTable(page.transactions.map((tx) => ({
        time: tx.createdAt,
        type: tx.type,
        amount: tx.amount.toFixed(6),
        balance: tx.balanceAfter.toFixed(6),
        model: tx.modelId ?? '',
      })), [
        { key: 'time', label: 'Timestamp', width: 24 },
        { key: 'type', label: 'Type', width: 12 },
        { key: 'amount', label: 'Amount', width: 14 },
        { key: 'balance', label: 'Balance', width: 14 },
        { key: 'model', label: 'Model', width: 30 },
      ]));
      if (page.pagination.hasMore) {
        console.log(getChalk().dim(`More results available (limit ${page.pagination.limit}, offset ${page.pagination.offset}).`));
      }
    });

  wallet
    .command('top-up')
    .description('Probe x402 payment requirements and sign a top-up with the x402 SDK (or submit a signed PAYMENT-SIGNATURE header)')
    .option('--payment-signature <header>', 'Signed x402 v2 payment payload (base64) to submit instead of probing requirements')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      if (options.paymentSignature) {
        const result = await submitTopUp(String(options.paymentSignature).trim());
        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(c.green('✓') + ' Top-up submitted');
        console.log(`Wallet: ${result.walletAddress}`);
        console.log(`Credited: ${c.bold(`$${result.amountCredited}`)}`);
        console.log(`New balance: ${c.bold(`$${result.newBalance.toFixed(6)}`)}`);
        console.log(`Payment ID: ${result.paymentId}`);
        return;
      }

      const requirements = await probeTopUpRequirements();
      if (format === 'json') {
        console.log(JSON.stringify(requirements, null, 2));
        return;
      }
      printTopUpGuide(requirements, c);
    });
}

/** Render the payment options and the exact x402 SDK signing steps. */
function printTopUpGuide(
  requirements: { x402Version: number; accepts: X402PaymentRequirement[] },
  c: ReturnType<typeof getChalk>
): void {
  console.log(c.bold('x402 top-up payment requirements'));
  console.log(c.dim(`x402 protocol version: ${requirements.x402Version}\n`));

  if (requirements.accepts.length === 0) {
    console.log(c.yellow('⚠ The API returned no payment options. Try again later or check https://docs.venice.ai.'));
    return;
  }

  console.log(formatTable(requirements.accepts.map((entry) => ({
    network: entry.network,
    asset: shortAsset(entry.asset),
    payTo: shortAsset(entry.payTo),
    minAmount: `${baseUnitsToUsd(entry.amount)} USD`,
    scheme: entry.scheme,
  })), [
    { key: 'network', label: 'Network', width: 40 },
    { key: 'asset', label: 'USDC asset', width: 20 },
    { key: 'payTo', label: 'Pay to', width: 20 },
    { key: 'minAmount', label: 'Minimum', width: 12 },
    { key: 'scheme', label: 'Scheme', width: 8 },
  ]));
  console.log(c.dim('\nAmounts are USDC base units (6 decimals) on-chain; minimum shown in USD.'));

  const primary = requirements.accepts[0];
  console.log(`\n${c.bold('How to top up (exact steps)')}`);
  console.log(`1. ${c.dim('Install the x402 SDK:')} npm install x402`);
  console.log(`   ${c.dim('(or, for a higher-level client:')} npm install @venice-ai/x402-client${c.dim(')')}`);
  console.log(`2. ${c.dim('Sign the chosen payment option from the table above using the SDK:')}`);
  console.log(c.dim(`   const { createPaymentHeader } = require('x402')  // see the SDK docs for the exact signature`));
  console.log(c.dim('   const header = await createPaymentHeader({'));
  console.log(c.dim(`     network: '${primary.network}',`));
  console.log(c.dim(`     asset:   '${primary.asset}',`));
  console.log(c.dim(`     payTo:   '${primary.payTo}',`));
  console.log(c.dim(`     amount:  '${primary.amount}',  // base units — the minimum above; pay more by increasing this`));
  console.log(c.dim('     // ...provide your wallet signer/private key'));
  console.log(c.dim('   })'));
  console.log(`3. ${c.dim('Submit the signed header:')} venice wallet top-up --payment-signature "<header>"`);
  console.log(c.dim('   (the legacy X-402-Payment / X-PAYMENT header names are also accepted by the API)'));
  console.log('');
}

/** USDC has 6 decimals; show the human USD equivalent for guidance only. */
function baseUnitsToUsd(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return amount;
  return `$${(value / 1e6).toFixed(2)}`;
}

/** Shorten long token/address values for table display. */
function shortAsset(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}
