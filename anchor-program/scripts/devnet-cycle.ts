/**
 * Devnet smoke cycle for bazr_market.
 *
 * Runs the five instructions the product depends on as real on-chain
 * transactions and prints each signature with its explorer URL, then reads the
 * resulting accounts back. A transaction that lands is not evidence on its own;
 * the account read at the end is what proves the state actually changed.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=/path/to/your-deployer.json \
 *   npx ts-node scripts/devnet-cycle.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Connection, ConfirmOptions, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { BazrMarket } from "../target/types/bazr_market";

const MARKET_SEED = Buffer.from("market");
const BOND_VAULT_SEED = Buffer.from("bond_vault");
const STALL_SEED = Buffer.from("stall");
const LISTING_SEED = Buffer.from("listing");
const CRATE_SEED = Buffer.from("crate");

const DECIMALS = 6;
const BOND = new BN(1_000).mul(new BN(10).pow(new BN(DECIMALS)));
const SLASH_BPS = 3_000;
const FEE_BPS = 100;

const STATE_FILE = path.join(__dirname, "..", ".devnet-cycle-state.json");

/**
 * Blockhashes are taken at `finalized`. Public devnet RPC regularly answers a
 * `confirmed` blockhash from a node that the sending node has not caught up to,
 * which surfaces as "Blockhash not found" on an otherwise valid transaction.
 */
const OPTS: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "finalized",
  maxRetries: 5,
};

/** Public devnet RPC is rate limited and occasionally stale; retry transients. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String((err as any)?.message ?? err);
      const transient =
        msg.includes("Blockhash not found") ||
        msg.includes("429") ||
        msg.includes("Too Many Requests") ||
        msg.includes("block height exceeded") ||
        msg.includes("timed out");
      if (!transient || i === attempts) throw err;
      console.log(`  [retry ${i}/${attempts}] ${label}: ${msg.split("\n")[0]}`);
      await new Promise((r) => setTimeout(r, 2500 * i));
    }
  }
  throw lastErr;
}

const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const explorerAddr = (a: PublicKey | string) =>
  `https://explorer.solana.com/address/${a.toString()}?cluster=devnet`;

const sigs: { step: string; sig: string }[] = [];
function record(step: string, sig: string) {
  sigs.push({ step, sig });
  console.log(`  ${step.padEnd(18)} ${sig}`);
  console.log(`  ${" ".repeat(18)} ${explorer(sig)}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Blocks until the account is visible at `finalized`.
 *
 * `createMint` returns once the creation is `confirmed`, but the transactions
 * that follow are built on a `finalized` blockhash and simulated against that
 * slot -- where the mint may not exist yet. Waiting here is what removes the
 * AccountNotInitialized race, not a fixed sleep.
 */
/** Same race as `waitForAccount`, but for a token balance rather than existence. */
async function waitForBalance(
  connection: Connection,
  ata: PublicKey,
  atLeast: bigint,
  attempts = 40
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const acc = await getAccount(connection, ata, "finalized", TOKEN_2022_PROGRAM_ID);
      if (acc.amount >= atLeast) return;
    } catch {
      // account not visible at finalized yet
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`token account ${ata.toBase58()} never reached ${atLeast} at finalized`);
}

async function waitForAccount(
  connection: Connection,
  address: PublicKey,
  label: string,
  attempts = 40
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const info = await connection.getAccountInfo(address, "finalized");
    if (info !== null) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${label} (${address.toBase58()}) never became visible at finalized`);
}


async function main() {
  const envProvider = anchor.AnchorProvider.env();
  const connection = new Connection(envProvider.connection.rpcEndpoint, OPTS);
  const provider = new anchor.AnchorProvider(connection, envProvider.wallet, OPTS);
  anchor.setProvider(provider);
  const program = anchor.workspace.bazrMarket as Program<BazrMarket>;
  const wallet = (provider.wallet as anchor.Wallet).payer;

  console.log("program        :", program.programId.toBase58());
  console.log("program address:", explorerAddr(program.programId));
  console.log("payer          :", wallet.publicKey.toBase58());
  console.log("cluster        :", provider.connection.rpcEndpoint);
  console.log("");

  const [market] = PublicKey.findProgramAddressSync([MARKET_SEED], program.programId);
  const [bondVault] = PublicKey.findProgramAddressSync([BOND_VAULT_SEED], program.programId);
  const [stall] = PublicKey.findProgramAddressSync(
    [STALL_SEED, wallet.publicKey.toBuffer()],
    program.programId
  );

  // ---- market (created once; reused on a rerun) -------------------------
  let bazrMint: PublicKey;
  const existing = await program.account.market.fetchNullable(market);

  if (existing === null) {
    console.log("[1/7] creating the devnet BAZR test mint (Token-2022)");
    bazrMint = await withRetry("createMint(bazr)", () =>
      createMint(
        provider.connection,
        wallet,
        wallet.publicKey,
        null,
        DECIMALS,
        undefined,
        OPTS,
        TOKEN_2022_PROGRAM_ID
      )
    );
    console.log("  bazr_mint         :", bazrMint.toBase58());
    console.log("  ", explorerAddr(bazrMint));
    await waitForAccount(provider.connection, bazrMint, "bazr_mint");

    console.log("[2/7] initialize_market");
    const sig = await withRetry("rpc", () =>
      program.methods
        .initializeMarket(BOND, SLASH_BPS, FEE_BPS)
        .accountsPartial({
          market,
          bondVault,
          bazrMint,
          authority: wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(OPTS)
    );
    record("initialize_market", sig);
    await waitForAccount(provider.connection, market, "market PDA");
  } else {
    bazrMint = existing.bazrMint;
    console.log("[1-2/7] market already initialized -- reusing");
    console.log("  bazr_mint         :", bazrMint.toBase58());
  }

  // ---- bond tokens ------------------------------------------------------
  const ownerAta = getAssociatedTokenAddressSync(
    bazrMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  if ((await provider.connection.getAccountInfo(ownerAta)) === null) {
    await withRetry("createAta", () =>
      createAssociatedTokenAccount(
        provider.connection,
        wallet,
        bazrMint,
        wallet.publicKey,
        OPTS,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  await waitForAccount(provider.connection, ownerAta, "owner ATA");
  const bal = await getAccount(provider.connection, ownerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
  if (bal.amount < BigInt(BOND.toString())) {
    await withRetry("mintTo", () =>
      mintTo(
        provider.connection,
        wallet,
        bazrMint,
        ownerAta,
        wallet,
        BigInt(BOND.muln(5).toString()),
        [],
        OPTS,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  await waitForBalance(provider.connection, ownerAta, BigInt(BOND.toString()));

  // ---- 1. open_stall ----------------------------------------------------
  console.log("[3/7] open_stall");
  const stallState = await program.account.stall.fetchNullable(stall);
  if (stallState === null) {
    // The stall page is routed as /stall/[owner], so the evidence link is built
    // from the owner pubkey rather than a slug. An earlier run committed a
    // hand-written slug on a domain that was never registered, and because the
    // URI is written at open_stall it took an on-chain instruction to correct.
    const sig = await withRetry("rpc", () =>
      program.methods
        .openStall(`https://bazr.market/stall/${wallet.publicKey.toBase58()}`)
        .accountsPartial({
          market,
          stall,
          owner: wallet.publicKey,
          bazrMint,
          ownerTokenAccount: ownerAta,
          bondVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(OPTS)
    );
    record("open_stall", sig);
    await waitForAccount(provider.connection, stall, "stall PDA");
  } else {
    console.log("  stall already open -- skipping (PDA is per-owner and never reopened)");
  }
  await sleep(1000);

  // ---- 2. list_relic ----------------------------------------------------
  console.log("[4/7] list_relic (fresh devnet relic mint)");
  const relicMint = await withRetry("createMint(relicA)", () =>
    createMint(provider.connection, wallet, wallet.publicKey, null, 6, undefined, OPTS, TOKEN_PROGRAM_ID)
  );
  console.log("  relic mint        :", relicMint.toBase58());
  await waitForAccount(provider.connection, relicMint, "relic mint");
  const [listing] = PublicKey.findProgramAddressSync(
    [LISTING_SEED, stall.toBuffer(), relicMint.toBuffer()],
    program.programId
  );
  const thesis = "LP residual 61%, dev wallet untouched 214 days, floor flat for 9 weeks.";
  const thesisHash = Array.from(createHash("sha256").update(thesis).digest());

  {
    const sig = await withRetry("rpc", () =>
      program.methods
        .listRelic(613, thesisHash)
        .accountsPartial({
          market,
          stall,
          owner: wallet.publicKey,
          mint: relicMint,
          listing,
          systemProgram: SystemProgram.programId,
        })
        .rpc(OPTS)
    );
    record("list_relic", sig);
    await waitForAccount(provider.connection, listing, "listing PDA");
  }
  await sleep(1000);

  // ---- 3. resolve_listing ----------------------------------------------
  console.log("[5/7] resolve_listing (Survived)");
  {
    const sig = await withRetry("rpc", () =>
      program.methods
        .resolveListing({ survived: {} })
        .accountsPartial({ market, authority: wallet.publicKey, stall, listing })
        .rpc(OPTS)
    );
    record("resolve_listing", sig);
  }
  await sleep(1000);

  // ---- 4. create_crate --------------------------------------------------
  console.log("[6/7] create_crate");
  const crateId = new BN(Math.floor(Date.now() / 1000));
  const [cratePda] = PublicKey.findProgramAddressSync(
    [CRATE_SEED, wallet.publicKey.toBuffer(), crateId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const relicB = await withRetry("createMint(relicB)", () =>
    createMint(provider.connection, wallet, wallet.publicKey, null, 6, undefined, OPTS, TOKEN_PROGRAM_ID)
  );
  await waitForAccount(provider.connection, relicB, "relic mint B");
  {
    const sig = await withRetry("rpc", () =>
      program.methods
        .createCrate(crateId, "Devnet survivors", [relicMint, relicB], [6000, 4000])
        .accountsPartial({
          market,
          creator: wallet.publicKey,
          crateAccount: cratePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(OPTS)
    );
    record("create_crate", sig);
    await waitForAccount(provider.connection, cratePda, "crate PDA");
  }
  await sleep(1000);

  // ---- 5. rebalance_crate ----------------------------------------------
  console.log("[7/7] rebalance_crate");
  {
    const sig = await withRetry("rpc", () =>
      program.methods
        .rebalanceCrate([relicMint, relicB], [7500, 2500])
        .accountsPartial({ crateAccount: cratePda, creator: wallet.publicKey })
        .rpc(OPTS)
    );
    record("rebalance_crate", sig);
  }
  await sleep(2000);

  // ---- 6. the loss leg --------------------------------------------------
  // The five instructions above are the happy path. A stall that only ever
  // records wins would satisfy them, so the cycle also resolves a second
  // listing as Faded: the on-chain record must show both columns filled.
  console.log("[8/8] list_relic + resolve_listing (Faded) -- the loss leg");
  const relicFade = await withRetry("createMint(relicFade)", () =>
    createMint(provider.connection, wallet, wallet.publicKey, null, 6, undefined, OPTS, TOKEN_PROGRAM_ID)
  );
  await waitForAccount(provider.connection, relicFade, "faded relic mint");
  const [fadeListing] = PublicKey.findProgramAddressSync(
    [LISTING_SEED, stall.toBuffer(), relicFade.toBuffer()],
    program.programId
  );
  const fadeThesis = "LP pulled to 4%, dev wallet swept twice, floor never formed.";
  {
    const sig = await withRetry("rpc", () =>
      program.methods
        .listRelic(188, Array.from(createHash("sha256").update(fadeThesis).digest()))
        .accountsPartial({
          market,
          stall,
          owner: wallet.publicKey,
          mint: relicFade,
          listing: fadeListing,
          systemProgram: SystemProgram.programId,
        })
        .rpc(OPTS)
    );
    record("list_relic(fade)", sig);
    await waitForAccount(provider.connection, fadeListing, "faded listing PDA");
  }
  {
    const sig = await withRetry("rpc", () =>
      program.methods
        .resolveListing({ faded: {} })
        .accountsPartial({ market, authority: wallet.publicKey, stall, listing: fadeListing })
        .rpc(OPTS)
    );
    record("resolve(faded)", sig);
  }
  await sleep(2000);

  // ---- read the state back ---------------------------------------------
  console.log("\n=== on-chain state after the cycle (read back, not inferred) ===");
  const m = await program.account.market.fetch(market);
  const s = await program.account.stall.fetch(stall);
  const l = await program.account.listing.fetch(listing);
  const c = await program.account.crate.fetch(cratePda);

  console.log("market   ", market.toBase58());
  console.log("  total_stalls / listings / crates :",
    m.totalStalls.toString(), "/", m.totalListings.toString(), "/", m.totalCrates.toString());
  console.log("  total_resolved_wins / losses     :",
    m.totalResolvedWins.toString(), "/", m.totalResolvedLosses.toString());
  console.log("stall    ", stall.toBase58());
  console.log("  bond_amount                      :", s.bondAmount.toString());
  console.log("  listings_count / active          :", s.listingsCount, "/", s.activeListings);
  console.log("  resolved_wins / resolved_losses  :", s.resolvedWins, "/", s.resolvedLosses);
  console.log("  reputation                       :", s.reputation.toString());
  console.log("listing  ", listing.toBase58());
  console.log("  mint / relic_score / outcome     :",
    l.mint.toBase58(), "/", l.relicScoreAtListing, "/", JSON.stringify(l.outcome));
  console.log("  thesis_hash matches sha256       :",
    Buffer.from(l.thesisHash).equals(createHash("sha256").update(thesis).digest()));
  const fl = await program.account.listing.fetch(fadeListing);
  console.log("listing(faded)", fadeListing.toBase58());
  console.log("  outcome                          :", JSON.stringify(fl.outcome));
  console.log("crate    ", cratePda.toBase58());
  console.log("  weights / rebalance_count        :",
    JSON.stringify(c.weights), "/", c.rebalanceCount);

  const vault = await getAccount(provider.connection, bondVault, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log("bond vault balance                 :", vault.amount.toString());

  console.log("\n=== signatures ===");
  for (const { step, sig } of sigs) console.log(`${step.padEnd(18)} ${explorer(sig)}`);

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        programId: program.programId.toBase58(),
        cluster: "devnet",
        market: market.toBase58(),
        bondVault: bondVault.toBase58(),
        bazrMint: bazrMint.toBase58(),
        stall: stall.toBase58(),
        listing: listing.toBase58(),
        listingFaded: fadeListing.toBase58(),
        relicMint: relicMint.toBase58(),
        relicMintFaded: relicFade.toBase58(),
        crate: cratePda.toBase58(),
        crateId: crateId.toString(),
        signatures: sigs,
      },
      null,
      2
    ) + "\n"
  );
  console.log("\nstate written to", STATE_FILE);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
