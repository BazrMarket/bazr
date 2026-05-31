import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { assert } from "chai";
import { createHash } from "crypto";

import { BazrMarket } from "../target/types/bazr_market";

const MARKET_SEED = Buffer.from("market");
const BOND_VAULT_SEED = Buffer.from("bond_vault");
const STALL_SEED = Buffer.from("stall");
const LISTING_SEED = Buffer.from("listing");
const CRATE_SEED = Buffer.from("crate");

const DECIMALS = 6;
const UNIT = new BN(10).pow(new BN(DECIMALS));
const BOND = new BN(1_000).mul(UNIT); // 1000 BAZR
const SLASH_BPS = 3_000; // 30% burned on slash
const FEE_BPS = 100;

/** sha256 of the off-chain thesis text -- what the listing commits to. */
function thesisHash(text: string): number[] {
  return Array.from(createHash("sha256").update(text).digest());
}

/** Asserts a rejected instruction failed with the given Anchor error code. */
async function expectAnchorError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    const anchorErr = AnchorError.parse((err as any).logs ?? []);
    const actual = anchorErr?.error?.errorCode?.code ?? (err as any)?.error?.errorCode?.code;
    assert.strictEqual(actual, code, `expected ${code}, got ${actual ?? err}`);
    return;
  }
  assert.fail(`expected the instruction to fail with ${code}, but it succeeded`);
}

describe("bazr_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.bazrMarket as Program<BazrMarket>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  // Curators
  const stallOwner = Keypair.generate();
  const slashOwner = Keypair.generate();
  const poorOwner = Keypair.generate();

  let bazrMint: PublicKey;
  let relicA: PublicKey;
  let relicB: PublicKey;
  let relicC: PublicKey;

  let stallOwnerAta: PublicKey;
  let slashOwnerAta: PublicKey;
  let poorOwnerAta: PublicKey;

  let market: PublicKey;
  let bondVault: PublicKey;
  let stall: PublicKey;
  let slashStallPda: PublicKey;

  const crateId = new BN(1);
  let cratePda: PublicKey;

  const listingPda = (stallKey: PublicKey, mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [LISTING_SEED, stallKey.toBuffer(), mint.toBuffer()],
      program.programId
    )[0];

  before(async () => {
    for (const kp of [stallOwner, slashOwner, poorOwner]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // Bond mint is Token-2022: the launch token is a pump.fun mint, and the
    // program talks to it through token_interface.
    bazrMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      DECIMALS,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Listed memes are plain SPL mints -- proves the program accepts both.
    relicA = await createMint(provider.connection, authority, authority.publicKey, null, 6);
    relicB = await createMint(provider.connection, authority, authority.publicKey, null, 6);
    relicC = await createMint(provider.connection, authority, authority.publicKey, null, 6);

    const makeAta = async (owner: PublicKey) =>
      createAssociatedTokenAccount(
        provider.connection,
        authority,
        bazrMint,
        owner,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

    stallOwnerAta = await makeAta(stallOwner.publicKey);
    slashOwnerAta = await makeAta(slashOwner.publicKey);
    poorOwnerAta = await makeAta(poorOwner.publicKey);

    for (const ata of [stallOwnerAta, slashOwnerAta]) {
      await mintTo(
        provider.connection,
        authority,
        bazrMint,
        ata,
        authority,
        BigInt(BOND.muln(3).toString()),
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
    }
    // poorOwner is deliberately left at zero balance.

    [market] = PublicKey.findProgramAddressSync([MARKET_SEED], program.programId);
    [bondVault] = PublicKey.findProgramAddressSync([BOND_VAULT_SEED], program.programId);
    [stall] = PublicKey.findProgramAddressSync(
      [STALL_SEED, stallOwner.publicKey.toBuffer()],
      program.programId
    );
    [slashStallPda] = PublicKey.findProgramAddressSync(
      [STALL_SEED, slashOwner.publicKey.toBuffer()],
      program.programId
    );
    [cratePda] = PublicKey.findProgramAddressSync(
      [CRATE_SEED, stallOwner.publicKey.toBuffer(), crateId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  });

  // ---------------------------------------------------------------- market

  it("refuses a market with a zero bond or an out-of-range bps", async () => {
    // Runs before the real init: a reverted tx leaves the market PDA uncreated,
    // so the argument checks are reachable.
    await expectAnchorError(
      program.methods
        .initializeMarket(new BN(0), SLASH_BPS, FEE_BPS)
        .accountsPartial({
          market,
          bondVault,
          bazrMint,
          authority: authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      "InvalidBondAmount"
    );

    await expectAnchorError(
      program.methods
        .initializeMarket(BOND, 10_001, FEE_BPS)
        .accountsPartial({
          market,
          bondVault,
          bazrMint,
          authority: authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      "InvalidBps"
    );
  });

  it("initializes the market", async () => {
    await program.methods
      .initializeMarket(BOND, SLASH_BPS, FEE_BPS)
      .accountsPartial({
        market,
        bondVault,
        bazrMint,
        authority: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.market.fetch(market);
    assert.strictEqual(state.authority.toBase58(), authority.publicKey.toBase58());
    assert.strictEqual(state.bazrMint.toBase58(), bazrMint.toBase58());
    assert.strictEqual(state.bondVault.toBase58(), bondVault.toBase58());
    assert.strictEqual(state.stallBondAmount.toString(), BOND.toString());
    assert.strictEqual(state.slashBps, SLASH_BPS);
    assert.strictEqual(state.feeBps, FEE_BPS);
    assert.isFalse(state.paused);
    assert.strictEqual(state.totalStalls.toNumber(), 0);
  });

  // ----------------------------------------------------------------- stall

  it("opens a stall and escrows the bond", async () => {
    const before = await getAccount(
      provider.connection,
      stallOwnerAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .openStall("https://bazr.market/stall/rummager")
      .accountsPartial({
        market,
        stall,
        owner: stallOwner.publicKey,
        bazrMint,
        ownerTokenAccount: stallOwnerAta,
        bondVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([stallOwner])
      .rpc();

    const after = await getAccount(
      provider.connection,
      stallOwnerAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const vault = await getAccount(provider.connection, bondVault, undefined, TOKEN_2022_PROGRAM_ID);

    assert.strictEqual((before.amount - after.amount).toString(), BOND.toString());
    assert.strictEqual(vault.amount.toString(), BOND.toString());

    const state = await program.account.stall.fetch(stall);
    assert.strictEqual(state.owner.toBase58(), stallOwner.publicKey.toBase58());
    assert.strictEqual(state.bondAmount.toString(), BOND.toString());
    assert.strictEqual(state.resolvedWins, 0);
    assert.strictEqual(state.resolvedLosses, 0);
    assert.strictEqual(state.reputation.toNumber(), 0);
    assert.isFalse(state.slashed);
    assert.strictEqual(state.uri, "https://bazr.market/stall/rummager");

    const marketState = await program.account.market.fetch(market);
    assert.strictEqual(marketState.totalStalls.toNumber(), 1);
  });

  it("refuses to open a stall when the bond balance is short", async () => {
    const [poorStall] = PublicKey.findProgramAddressSync(
      [STALL_SEED, poorOwner.publicKey.toBuffer()],
      program.programId
    );

    await expectAnchorError(
      program.methods
        .openStall("https://bazr.market/stall/broke")
        .accountsPartial({
          market,
          stall: poorStall,
          owner: poorOwner.publicKey,
          bazrMint,
          ownerTokenAccount: poorOwnerAta,
          bondVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([poorOwner])
        .rpc(),
      "InsufficientBond"
    );
  });

  it("refuses a stall URI longer than 96 bytes", async () => {
    const [poorStall] = PublicKey.findProgramAddressSync(
      [STALL_SEED, poorOwner.publicKey.toBuffer()],
      program.programId
    );

    await expectAnchorError(
      program.methods
        .openStall("x".repeat(97))
        .accountsPartial({
          market,
          stall: poorStall,
          owner: poorOwner.publicKey,
          bazrMint,
          ownerTokenAccount: poorOwnerAta,
          bondVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([poorOwner])
        .rpc(),
      "UriTooLong"
    );
  });

  // --------------------------------------------------------------- listing

  it("lists a relic with its thesis hash committed", async () => {
    const listing = listingPda(stall, relicA);
    const hash = thesisHash("LP still locked, dev wallet untouched for 9 months.");

    await program.methods
      .listRelic(742, hash)
      .accountsPartial({
        market,
        stall,
        owner: stallOwner.publicKey,
        mint: relicA,
        listing,
        systemProgram: SystemProgram.programId,
      })
      .signers([stallOwner])
      .rpc();

    const state = await program.account.listing.fetch(listing);
    assert.strictEqual(state.stall.toBase58(), stall.toBase58());
    assert.strictEqual(state.mint.toBase58(), relicA.toBase58());
    assert.strictEqual(state.relicScoreAtListing, 742);
    assert.deepStrictEqual(Array.from(state.thesisHash), hash);
    assert.deepStrictEqual(state.outcome, { pending: {} });
    assert.strictEqual(state.resolvedAt.toNumber(), 0);

    const stallState = await program.account.stall.fetch(stall);
    assert.strictEqual(stallState.listingsCount, 1);
    assert.strictEqual(stallState.activeListings, 1);
  });

  it("refuses a listing with an empty thesis hash", async () => {
    await expectAnchorError(
      program.methods
        .listRelic(500, new Array(32).fill(0))
        .accountsPartial({
          market,
          stall,
          owner: stallOwner.publicKey,
          mint: relicB,
          listing: listingPda(stall, relicB),
          systemProgram: SystemProgram.programId,
        })
        .signers([stallOwner])
        .rpc(),
      "EmptyThesisHash"
    );
  });

  it("refuses a relic score above 1000", async () => {
    await expectAnchorError(
      program.methods
        .listRelic(1001, thesisHash("out of range"))
        .accountsPartial({
          market,
          stall,
          owner: stallOwner.publicKey,
          mint: relicB,
          listing: listingPda(stall, relicB),
          systemProgram: SystemProgram.programId,
        })
        .signers([stallOwner])
        .rpc(),
      "RelicScoreOutOfRange"
    );
  });

  it("refuses a listing signed by someone other than the stall owner", async () => {
    await expectAnchorError(
      program.methods
        .listRelic(500, thesisHash("not my stall"))
        .accountsPartial({
          market,
          stall,
          owner: slashOwner.publicKey,
          mint: relicB,
          listing: listingPda(stall, relicB),
          systemProgram: SystemProgram.programId,
        })
        .signers([slashOwner])
        .rpc(),
      "ConstraintSeeds"
    );
  });

  // ------------------------------------------------------------ resolution

  it("records a win", async () => {
    const listing = listingPda(stall, relicA);

    await program.methods
      .resolveListing({ survived: {} })
      .accountsPartial({ market, authority: authority.publicKey, stall, listing })
      .rpc();

    const state = await program.account.listing.fetch(listing);
    assert.deepStrictEqual(state.outcome, { survived: {} });
    assert.isAbove(state.resolvedAt.toNumber(), 0);

    const stallState = await program.account.stall.fetch(stall);
    assert.strictEqual(stallState.resolvedWins, 1);
    assert.strictEqual(stallState.resolvedLosses, 0);
    assert.strictEqual(stallState.reputation.toNumber(), 100);
    assert.strictEqual(stallState.activeListings, 0);
  });

  it("records a loss with the same weight as a win", async () => {
    const listing = listingPda(stall, relicB);

    await program.methods
      .listRelic(310, thesisHash("LP thinning, dev wallet moved twice this week."))
      .accountsPartial({
        market,
        stall,
        owner: stallOwner.publicKey,
        mint: relicB,
        listing,
        systemProgram: SystemProgram.programId,
      })
      .signers([stallOwner])
      .rpc();

    await program.methods
      .resolveListing({ faded: {} })
      .accountsPartial({ market, authority: authority.publicKey, stall, listing })
      .rpc();

    const state = await program.account.listing.fetch(listing);
    assert.deepStrictEqual(state.outcome, { faded: {} });

    const stallState = await program.account.stall.fetch(stall);
    assert.strictEqual(stallState.resolvedWins, 1);
    assert.strictEqual(stallState.resolvedLosses, 1);
    // A loss subtracts exactly what a win added: one of each nets to zero.
    assert.strictEqual(stallState.reputation.toNumber(), 0);

    const marketState = await program.account.market.fetch(market);
    assert.strictEqual(marketState.totalResolvedWins.toNumber(), 1);
    assert.strictEqual(marketState.totalResolvedLosses.toNumber(), 1);
  });

  it("refuses resolution by anyone other than the market authority", async () => {
    const listing = listingPda(stall, relicC);

    await program.methods
      .listRelic(505, thesisHash("floor holding, social afterglow fading."))
      .accountsPartial({
        market,
        stall,
        owner: stallOwner.publicKey,
        mint: relicC,
        listing,
        systemProgram: SystemProgram.programId,
      })
      .signers([stallOwner])
      .rpc();

    // The stall owner grading their own call is exactly what must not work.
    await expectAnchorError(
      program.methods
        .resolveListing({ survived: {} })
        .accountsPartial({ market, authority: stallOwner.publicKey, stall, listing })
        .signers([stallOwner])
        .rpc(),
      "ConstraintHasOne"
    );
  });

  it("refuses to resolve a listing twice", async () => {
    const listing = listingPda(stall, relicA);

    await expectAnchorError(
      program.methods
        .resolveListing({ faded: {} })
        .accountsPartial({ market, authority: authority.publicKey, stall, listing })
        .rpc(),
      "ListingNotPending"
    );
  });

  it("refuses Pending as a resolution outcome", async () => {
    const listing = listingPda(stall, relicC);

    await expectAnchorError(
      program.methods
        .resolveListing({ pending: {} })
        .accountsPartial({ market, authority: authority.publicKey, stall, listing })
        .rpc(),
      "InvalidResolution"
    );
  });

  it("withdraws a pending listing without deleting the record", async () => {
    const listing = listingPda(stall, relicC);

    await program.methods
      .withdrawListing()
      .accountsPartial({ stall, owner: stallOwner.publicKey, listing })
      .signers([stallOwner])
      .rpc();

    const state = await program.account.listing.fetch(listing);
    assert.deepStrictEqual(state.outcome, { withdrawn: {} });
    assert.isAbove(state.resolvedAt.toNumber(), 0);

    const stallState = await program.account.stall.fetch(stall);
    assert.strictEqual(stallState.activeListings, 0);
    // Withdrawal counts as neither a win nor a loss, and the listing survives.
    assert.strictEqual(stallState.resolvedWins, 1);
    assert.strictEqual(stallState.resolvedLosses, 1);
    assert.strictEqual(stallState.listingsCount, 3);
  });

  // ----------------------------------------------------------------- crate

  it("creates a crate whose weights sum to 10000 bps", async () => {
    await program.methods
      .createCrate(crateId, "Q4 survivors", [relicA, relicB, relicC], [5000, 3000, 2000])
      .accountsPartial({
        market,
        creator: stallOwner.publicKey,
        crateAccount: cratePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([stallOwner])
      .rpc();

    const state = await program.account.crate.fetch(cratePda);
    assert.strictEqual(state.creator.toBase58(), stallOwner.publicKey.toBase58());
    assert.strictEqual(state.crateId.toString(), "1");
    assert.strictEqual(state.name, "Q4 survivors");
    assert.deepStrictEqual(
      state.mints.map((m) => m.toBase58()),
      [relicA, relicB, relicC].map((m) => m.toBase58())
    );
    assert.deepStrictEqual(state.weights, [5000, 3000, 2000]);
    assert.strictEqual(state.rebalanceCount, 0);
    assert.isFalse(state.frozen);

    const marketState = await program.account.market.fetch(market);
    assert.strictEqual(marketState.totalCrates.toNumber(), 1);
  });

  it("refuses a crate whose weights do not sum to 10000 bps", async () => {
    const badId = new BN(2);
    const [badCrate] = PublicKey.findProgramAddressSync(
      [CRATE_SEED, stallOwner.publicKey.toBuffer(), badId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await expectAnchorError(
      program.methods
        .createCrate(badId, "Under-allocated", [relicA, relicB], [5000, 3000])
        .accountsPartial({
          market,
          creator: stallOwner.publicKey,
          crateAccount: badCrate,
          systemProgram: SystemProgram.programId,
        })
        .signers([stallOwner])
        .rpc(),
      "WeightsNotFullyAllocated"
    );
  });

  it("refuses a crate holding the same mint twice", async () => {
    const badId = new BN(3);
    const [badCrate] = PublicKey.findProgramAddressSync(
      [CRATE_SEED, stallOwner.publicKey.toBuffer(), badId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await expectAnchorError(
      program.methods
        .createCrate(badId, "Doubled", [relicA, relicA], [5000, 5000])
        .accountsPartial({
          market,
          creator: stallOwner.publicKey,
          crateAccount: badCrate,
          systemProgram: SystemProgram.programId,
        })
        .signers([stallOwner])
        .rpc(),
      "DuplicateMint"
    );
  });

  it("rebalances a crate", async () => {
    await program.methods
      .rebalanceCrate([relicA, relicC], [6000, 4000])
      .accountsPartial({ crateAccount: cratePda, creator: stallOwner.publicKey })
      .signers([stallOwner])
      .rpc();

    const state = await program.account.crate.fetch(cratePda);
    assert.deepStrictEqual(
      state.mints.map((m) => m.toBase58()),
      [relicA, relicC].map((m) => m.toBase58())
    );
    assert.deepStrictEqual(state.weights, [6000, 4000]);
    assert.strictEqual(state.rebalanceCount, 1);
    assert.isAbove(state.lastRebalancedAt.toNumber(), 0);
  });

  it("refuses a rebalance signed by someone other than the creator", async () => {
    await expectAnchorError(
      program.methods
        .rebalanceCrate([relicA, relicC], [5000, 5000])
        .accountsPartial({ crateAccount: cratePda, creator: slashOwner.publicKey })
        .signers([slashOwner])
        .rpc(),
      "ConstraintSeeds"
    );
  });

  it("freezes a crate and then refuses further rebalancing", async () => {
    await program.methods
      .freezeCrate()
      .accountsPartial({ crateAccount: cratePda, creator: stallOwner.publicKey })
      .signers([stallOwner])
      .rpc();

    const state = await program.account.crate.fetch(cratePda);
    assert.isTrue(state.frozen);

    await expectAnchorError(
      program.methods
        .rebalanceCrate([relicA, relicC], [7000, 3000])
        .accountsPartial({ crateAccount: cratePda, creator: stallOwner.publicKey })
        .signers([stallOwner])
        .rpc(),
      "CrateFrozen"
    );
  });

  // ----------------------------------------------------------------- slash

  it("slashes a stall: burns slash_bps of the bond and returns the rest", async () => {
    await program.methods
      .openStall("https://bazr.market/stall/manipulator")
      .accountsPartial({
        market,
        stall: slashStallPda,
        owner: slashOwner.publicKey,
        bazrMint,
        ownerTokenAccount: slashOwnerAta,
        bondVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([slashOwner])
      .rpc();

    const supplyBefore = (await getMint(provider.connection, bazrMint, undefined, TOKEN_2022_PROGRAM_ID)).supply;
    const ownerBefore = (await getAccount(provider.connection, slashOwnerAta, undefined, TOKEN_2022_PROGRAM_ID)).amount;

    await program.methods
      .slashStall(7)
      .accountsPartial({
        market,
        authority: authority.publicKey,
        stall: slashStallPda,
        bazrMint,
        ownerTokenAccount: slashOwnerAta,
        bondVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const expectedBurn = BOND.muln(SLASH_BPS).divn(10_000);
    const expectedReturn = BOND.sub(expectedBurn);

    const supplyAfter = (await getMint(provider.connection, bazrMint, undefined, TOKEN_2022_PROGRAM_ID)).supply;
    const ownerAfter = (await getAccount(provider.connection, slashOwnerAta, undefined, TOKEN_2022_PROGRAM_ID)).amount;

    assert.strictEqual((supplyBefore - supplyAfter).toString(), expectedBurn.toString());
    assert.strictEqual((ownerAfter - ownerBefore).toString(), expectedReturn.toString());

    const state = await program.account.stall.fetch(slashStallPda);
    assert.isTrue(state.slashed);
    assert.strictEqual(state.slashedAmount.toString(), expectedBurn.toString());
    assert.strictEqual(state.bondAmount.toNumber(), 0);

    const marketState = await program.account.market.fetch(market);
    assert.strictEqual(marketState.totalBondBurned.toString(), expectedBurn.toString());
  });

  it("refuses to close a slashed stall", async () => {
    await expectAnchorError(
      program.methods
        .closeStall()
        .accountsPartial({
          market,
          stall: slashStallPda,
          owner: slashOwner.publicKey,
          bazrMint,
          ownerTokenAccount: slashOwnerAta,
          bondVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([slashOwner])
        .rpc(),
      "StallSlashed"
    );
  });

  it("refuses to list from a slashed stall", async () => {
    await expectAnchorError(
      program.methods
        .listRelic(600, thesisHash("still trying"))
        .accountsPartial({
          market,
          stall: slashStallPda,
          owner: slashOwner.publicKey,
          mint: relicA,
          listing: listingPda(slashStallPda, relicA),
          systemProgram: SystemProgram.programId,
        })
        .signers([slashOwner])
        .rpc(),
      "StallSlashed"
    );
  });

  // ----------------------------------------------------------------- close

  it("refuses to close a stall that still has pending listings", async () => {
    // Every earlier listing is settled; put a fresh one on a brand new mint.
    const pendingMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    await program.methods
      .listRelic(400, thesisHash("still on the table"))
      .accountsPartial({
        market,
        stall,
        owner: stallOwner.publicKey,
        mint: pendingMint,
        listing: listingPda(stall, pendingMint),
        systemProgram: SystemProgram.programId,
      })
      .signers([stallOwner])
      .rpc();

    await expectAnchorError(
      program.methods
        .closeStall()
        .accountsPartial({
          market,
          stall,
          owner: stallOwner.publicKey,
          bazrMint,
          ownerTokenAccount: stallOwnerAta,
          bondVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([stallOwner])
        .rpc(),
      "StallHasActiveListings"
    );

    await program.methods
      .withdrawListing()
      .accountsPartial({ stall, owner: stallOwner.publicKey, listing: listingPda(stall, pendingMint) })
      .signers([stallOwner])
      .rpc();

    const withdrawn = await program.account.listing.fetch(listingPda(stall, pendingMint));
    assert.deepStrictEqual(withdrawn.outcome, { withdrawn: {} });
    assert.strictEqual((await program.account.stall.fetch(stall)).activeListings, 0);
  });

  it("closes the stall, returns the bond and keeps the record on chain", async () => {
    const before = await getAccount(provider.connection, stallOwnerAta, undefined, TOKEN_2022_PROGRAM_ID);

    await program.methods
      .closeStall()
      .accountsPartial({
        market,
        stall,
        owner: stallOwner.publicKey,
        bazrMint,
        ownerTokenAccount: stallOwnerAta,
        bondVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([stallOwner])
      .rpc();

    const after = await getAccount(provider.connection, stallOwnerAta, undefined, TOKEN_2022_PROGRAM_ID);
    assert.strictEqual((after.amount - before.amount).toString(), BOND.toString());

    // The account is deliberately NOT deallocated: reopening at the same PDA
    // must not wipe a losing record.
    const state = await program.account.stall.fetch(stall);
    assert.strictEqual(state.bondAmount.toNumber(), 0);
    assert.isAbove(state.closedAt.toNumber(), 0);
    assert.strictEqual(state.resolvedWins, 1);
    assert.strictEqual(state.resolvedLosses, 1);
  });

  it("refuses to close the same stall twice", async () => {
    await expectAnchorError(
      program.methods
        .closeStall()
        .accountsPartial({
          market,
          stall,
          owner: stallOwner.publicKey,
          bazrMint,
          ownerTokenAccount: stallOwnerAta,
          bondVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([stallOwner])
        .rpc(),
      "BondAlreadyReleased"
    );
  });

  it("leaves the bond vault empty once every bond is settled", async () => {
    const vault = await getAccount(provider.connection, bondVault, undefined, TOKEN_2022_PROGRAM_ID);
    assert.strictEqual(vault.amount.toString(), "0");
  });
});
