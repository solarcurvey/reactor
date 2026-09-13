import {
  FAILURE_COPY,
  isQuoteInject,
  parseQaInject,
  parseQaState,
  qaInjectEnabled,
  ServiceUnavailableError,
} from "./qa-inject.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseQaInject("?inject=indexer") === "indexer", "indexer inject");
assert(parseQaInject("inject=rpc&qa=1") === "rpc", "rpc inject without ?");
assert(parseQaInject("?inject=quote-429") === "quote-429", "quote 429");
assert(parseQaInject("?inject=quote-413") === "quote-413", "quote 413");
assert(parseQaInject("?inject=quote-5xx") === "quote-5xx", "quote 5xx");
assert(parseQaInject("?inject=quote-stale") === "quote-stale", "stale");
assert(parseQaInject("?inject=quote-expired") === "quote-expired", "expired");
assert(parseQaInject("?inject=quote-noroute") === "quote-noroute", "noroute");
assert(parseQaInject("?inject=pricing") === "pricing", "pricing");
assert(parseQaInject("?inject=upload") === "upload", "upload");
assert(parseQaInject("?inject=sse") === "sse", "sse");
assert(parseQaInject("?inject=empty") === "empty", "empty");
assert(parseQaInject("?inject=token-invalid") === "token-invalid", "token-invalid");
assert(parseQaInject("?inject=ticker-invalid") === "ticker-invalid", "ticker-invalid");
assert(parseQaInject("?inject=wallet-reject") === "wallet-reject", "wallet-reject");
assert(parseQaInject("?inject=wallet-revert") === "wallet-revert", "wallet-revert");
assert(parseQaInject("?inject=oracle") === null, "unknown inject ignored");
assert(parseQaInject("?qa=1") === null, "qa panel is not an inject kind");

assert(parseQaState("?state=loading") === "loading", "loading state");
assert(parseQaState("?state=filter-bonding") === "filter-bonding", "filter state");
assert(parseQaState("?state=tx-pending") === "tx-pending", "tx pending");
assert(parseQaState("?state=wallet-menu") === "wallet-menu", "wallet menu");
assert(parseQaState("?state=nope") === null, "unknown state");

assert(isQuoteInject("quote-429"), "429 is quote-class");
assert(!isQuoteInject("indexer"), "indexer is not quote-class");
assert(FAILURE_COPY.pricing.body.includes("SIGNER_STORE_UNAVAILABLE"), "pricing fail-closed");
assert(FAILURE_COPY["quote-413"].body.includes("16KiB"), "413 names the cap");
assert(FAILURE_COPY.sse.body.includes("duplicate"), "sse no-dupe copy");

const err = new ServiceUnavailableError("indexer");
assert(err.kind === "indexer", "error kind");
assert(err.message === FAILURE_COPY.indexer.body, "default message");

const review = process.env.NEXT_PUBLIC_REVIEW_FIXTURES === "1";
const qa = process.env.NEXT_PUBLIC_QA_INJECT === "1";
if (!review && !qa) {
  assert(qaInjectEnabled() === false, "inject off by default in unit env");
}

console.log("qa-inject ok");
