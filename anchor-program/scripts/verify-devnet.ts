/**
 * Read-only devnet verifier for bazr_market.
 *
 * Reads the chain, not the local state file. `.devnet-cycle-state.json` is a
 * record written by the cycle runner; this script treats it only as a list of
 * addresses to go look up, and every claim below comes back from an RPC call.
 * Sends no transactions.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=/path/to/your-deployer.json \
 *   npx ts-node scripts/verify-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { BazrMarket } from "../target/types/bazr_market";

const STATE_FILE = path.join(__dirname, "..", ".devnet-cycle-state.json");
const tx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const addr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

async function main() {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.bazrMarket as Program<BazrMarket>;
  const c: Connection = provider.connection;

  console.log("rpc            :", c.rpcEndpoint);
  console.log("genesis        :", await c.getGenesisHash());
  console.log("program id     :", program.programId.toBase58());
  console.log("program url    :", addr(program.programId.toBase58()));

  const pinfo = await c.getAccountInfo(program.programId, "confirmed");
  console.log("program account:", pinfo === null ? "MISSING" : "EXISTS");
  if (pinfo) {
    console.log("  executable   :", pinfo.executable);
    console.log("  owner        :", pinfo.owner.toBase58());
  }

  // ---- 1. locate the two creation transactions the state file lacks -----
  // initialize_market and open_stall ran in an earlier session, so their
  // signatures are not in the state file. The chain still has them: the
  // oldest signature touching each PDA is the transaction that created it.
  console.log("\n=== creation transactions (oldest signature per PDA) ===");
  for (const [label, a] of [["initialize_market", state.market], ["open_stall", state.stall]] as const) {
    const list = await c.getSignaturesForAddress(new PublicKey(a), { limit: 1000 }, "confirmed");
    const oldest = list[list.length - 1];
    console.log(`${label.padEnd(18)} pda=${a}  sigs_touching=${list.length}`);
    if (oldest) {
      console.log(`${" ".repeat(18)} sig=${oldest.signature}`);
      console.log(`${" ".repeat(18)} err=${JSON.stringify(oldest.err)} slot=${oldest.slot} blockTime=${oldest.blockTime}`);
      console.log(`${" ".repeat(18)} ${tx(oldest.signature)}`);
    }
  }

  // ---- 2. confirm every recorded signature actually landed --------------
  console.log("\n=== recorded signatures, re-fetched from the chain ===");
  let ok = 0;
  for (const { step, sig } of state.signatures) {
    const t = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const verdict = t === null ? "NOT FOUND" : t.meta?.err ? `FAILED ${JSON.stringify(t.meta.err)}` : "OK";
    if (verdict === "OK") ok++;
    console.log(`${step.padEnd(18)} ${verdict.padEnd(9)} slot=${t?.slot ?? "-"}  ${sig}`);
    console.log(`${" ".repeat(18)} ${tx(sig)}`);
  }
  console.log(`recorded_signatures_verified=${ok}/${state.signatures.length}`);

  // ---- 3. read the accounts back ---------------------------------------
  console.log("\n=== account state, read from devnet ===");
  const m = await program.account.market.fetch(new PublicKey(state.market));
  const s = await program.account.stall.fetch(new PublicKey(state.stall));
  const l = await program.account.listing.fetch(new PublicKey(state.listing));
  const fl = await program.account.listing.fetch(new PublicKey(state.listingFaded));
  const cr = await program.account.crate.fetch(new PublicKey(state.crate));

  console.log("market  ", state.market);
  console.log("  ", addr(state.market));
  console.log("  authority                      :", m.authority.toBase58());
  console.log("  bazr_mint                      :", m.bazrMint.toBase58());
  console.log("  total_stalls/listings/crates   :", m.totalStalls.toString(), "/", m.totalListings.toString(), "/", m.totalCrates.toString());
  console.log("  total_resolved_wins/losses     :", m.totalResolvedWins.toString(), "/", m.totalResolvedLosses.toString());

  console.log("stall   ", state.stall);
  console.log("  ", addr(state.stall));
  console.log("  owner                          :", s.owner.toBase58());
  console.log("  bond_amount                    :", s.bondAmount.toString());
  console.log("  listings_count / active        :", s.listingsCount, "/", s.activeListings);
  console.log("  RESOLVED_WINS                  :", s.resolvedWins);
  console.log("  RESOLVED_LOSSES                :", s.resolvedLosses);
  console.log("  reputation                     :", s.reputation.toString());

  console.log("listing (survived leg)", state.listing);
  console.log("  outcome                        :", JSON.stringify(l.outcome));
  console.log("listing (faded leg)   ", state.listingFaded);
  console.log("  outcome                        :", JSON.stringify(fl.outcome));
  console.log("crate   ", state.crate);
  console.log("  weights / rebalance_count      :", JSON.stringify(cr.weights), "/", cr.rebalanceCount);

  // ---- 4. the honesty gate: both columns must be non-zero ---------------
  // A stall that only ever recorded wins would pass every instruction test
  // above. The product's premise is that losses are recorded at the same
  // weight, so the verdict is a conjunction, not a sum.
  const bothLegs = s.resolvedWins > 0 && s.resolvedLosses > 0;
  console.log("\nverdict=" + (bothLegs ? "PASS" : "FAIL") +
    `  (resolved_wins=${s.resolvedWins} > 0 AND resolved_losses=${s.resolvedLosses} > 0)`);
  process.exit(bothLegs ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
