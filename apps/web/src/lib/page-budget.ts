/**
 * Machine-checkable page budgets for issue #37.
 *
 * Counts are **O(1) or O(page)** in the number of indexed markets. A board
 * page is `BOARD_PAGE_SIZE` rows. Doubling the catalog must not double HTTP
 * or RPC waves. Live `POST /quote` tickets are outside this table.
 *
 * `rpcWaves` = `readContractsBatched` invocations (one multicall or one
 * Promise.all). `rpcCalls` = encoded view calls inside those waves.
 */

export const BOARD_PAGE_SIZE = 80;
export const PAGE_BUDGET_SCALE = 4_000;
export const EXPENSIVE_REFETCH_ON_FOCUS = false;

export type PageBudget = {
  http: number;
  rpcWaves: number;
  rpcCalls: number;
  maxRows: number;
  note: string;
};

export const PAGE_BUDGETS = {
  home: {
    http: 1,
    rpcWaves: 0,
    rpcCalls: 0,
    maxRows: BOARD_PAGE_SIZE,
    note: "GET /markets?limit=80",
  },
  search: {
    http: 1,
    rpcWaves: 0,
    rpcCalls: 0,
    maxRows: BOARD_PAGE_SIZE,
    note: "GET /markets?q=&stage=&limit=80",
  },
  token: {
    http: 1,
    rpcWaves: 1,
    rpcCalls: 6,
    maxRows: 1,
    note: "GET /page/token/:addr + batched CORE stats",
  },
  tokenWallet: {
    http: 1,
    rpcWaves: 2,
    rpcCalls: 10,
    maxRows: 1,
    note: "token page + CORE + ticket balance/allowance/pending batch",
  },
  launch: {
    http: 2,
    rpcWaves: 0,
    rpcCalls: 0,
    maxRows: 32,
    note: "GET /quote-assets + GET /ticker/:t",
  },
  rewards: {
    http: 1,
    rpcWaves: 1,
    rpcCalls: BOARD_PAGE_SIZE,
    maxRows: BOARD_PAGE_SIZE,
    note: "board page + one pendingRewards batch (not O(catalog))",
  },
  reactor: {
    http: 2,
    rpcWaves: 0,
    rpcCalls: 0,
    maxRows: 10,
    note: "GET /top10 + GET /reactor",
  },
  core: {
    http: 0,
    rpcWaves: 2,
    rpcCalls: 11,
    maxRows: 1,
    note: "CORE stats (6) + vesting (5), two waves",
  },
  quoteEcosystem: {
    http: 2,
    rpcWaves: 0,
    rpcCalls: 0,
    maxRows: BOARD_PAGE_SIZE,
    note: "GET /quote-assets + GET /markets?quote=",
  },
  wallet: {
    http: 0,
    rpcWaves: 1,
    rpcCalls: 3,
    maxRows: 1,
    note: "USDC + CORE balances + USDC router allowance, one batch",
  },
} as const satisfies Record<string, PageBudget>;

export type PageBudgetName = keyof typeof PAGE_BUDGETS;

export const PAGE_BUDGET_INVENTORY = Object.keys(PAGE_BUDGETS) as PageBudgetName[];

export type PageBudgetUsed = {
  http: number;
  rpcWaves: number;
  rpcCalls: number;
  rows: number;
};

export function assertWithinBudget(name: PageBudgetName, used: PageBudgetUsed): void {
  const b = PAGE_BUDGETS[name];
  if (used.http > b.http) {
    throw new Error(`${name} http ${used.http} exceeds budget ${b.http}`);
  }
  if (used.rpcWaves > b.rpcWaves) {
    throw new Error(`${name} rpcWaves ${used.rpcWaves} exceeds budget ${b.rpcWaves}`);
  }
  if (used.rpcCalls > b.rpcCalls) {
    throw new Error(`${name} rpcCalls ${used.rpcCalls} exceeds budget ${b.rpcCalls}`);
  }
  if (used.rows > b.maxRows) {
    throw new Error(`${name} rows ${used.rows} exceeds budget ${b.maxRows}`);
  }
}
