/**
 * Repoint a devnet stall's evidence URI.
 *
 * The stall's URI was committed at `open_stall` and pointed at a domain that
 * was never registered. Nothing else about the stall changes: this script must
 * leave `resolved_wins`, `resolved_losses` and `reputation` byte-identical, and
 * it reads them back afterwards to prove it did.
 *
 *   APPROVED_PUBKEY=<base58 pubkey of the stall owner you intend to touch> \
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=/path/to/your-deployer.json \
 *   NEW_URI=https://bazr.market/stall/devnet-rummager \
 *   npx ts-node scripts/set-stall-uri.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ConfirmOptions, Connection, PublicKey } from "@solana/web3.js";
import { BazrMarket } from "../target/types/bazr_market";

const STALL_SEED = Buffer.from("stall");
const MAX_STALL_URI_LEN = 96;

// Public devnet hands out `confirmed` blockhashes from nodes the sender has not
// caught up to; taking the blockhash at `finalized` avoids "Blockhash not found".
const OPTS: ConfirmOptions = {
  commitment: "confirmed",
  preflightCommitment: "finalized",
  maxRetries: 5,
};

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const tx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

async function main() {
  const newUri = process.env.NEW_URI;
  if (!newUri) throw new Error("NEW_URI not set");
  if (Buffer.byteLength(newUri) > MAX_STALL_URI_LEN) {
    throw new Error(`NEW_URI is ${Buffer.byteLength(newUri)} bytes, over the ${MAX_STALL_URI_LEN} byte limit`);
  }

  const envProvider = anchor.AnchorProvider.env();
  const connection = new Connection(envProvider.connection.rpcEndpoint, OPTS);
  const provider = new anchor.AnchorProvider(connection, envProvider.wallet, OPTS);
  anchor.setProvider(provider);
  const program = anchor.workspace.bazrMarket as Program<BazrMarket>;
  const owner = (provider.wallet as anchor.Wallet).payer;

  // --- hard signer gate: the wrapper cannot see an SDK path, so it is done here ---
  const approved = process.env.APPROVED_PUBKEY;
  if (!approved) throw new Error("APPROVED_PUBKEY not injected -- refusing to sign");
  if (owner.publicKey.toBase58() !== approved) {
    throw new Error(`wallet mismatch: approved=${approved} actual=${owner.publicKey.toBase58()}`);
  }
  // A URL string lies if it is a proxy or an alias; the genesis hash is the chain's identity.
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) {
    throw new Error(`not devnet: genesis=${genesis} expected=${DEVNET_GENESIS}`);
  }

  console.log("rpc            :", connection.rpcEndpoint);
  console.log("genesis        :", genesis, "(devnet)");
  console.log("program id     :", program.programId.toBase58());
  console.log("owner (signer) :", owner.publicKey.toBase58());

  const [stallPda] = PublicKey.findProgramAddressSync(
    [STALL_SEED, owner.publicKey.toBuffer()],
    program.programId,
  );
  console.log("stall pda      :", stallPda.toBase58());

  const before = await program.account.stall.fetch(stallPda);
  console.log("\n--- before ---");
  console.log("uri            :", before.uri);
  console.log("resolved_wins  :", before.resolvedWins);
  console.log("resolved_losses:", before.resolvedLosses);
  console.log("reputation     :", before.reputation.toString());
  console.log("listings_count :", before.listingsCount);

  console.log("\nnew uri        :", newUri, `(${Buffer.byteLength(newUri)} bytes)`);

  const sig = await program.methods
    .setStallUri(newUri)
    .accountsPartial({ stall: stallPda, owner: owner.publicKey })
    .signers([owner])
    .rpc();

  console.log("signature      :", sig);
  console.log("explorer       :", tx(sig));

  const after = await program.account.stall.fetch(stallPda);
  console.log("\n--- after (read back from chain) ---");
  console.log("uri            :", after.uri);
  console.log("resolved_wins  :", after.resolvedWins);
  console.log("resolved_losses:", after.resolvedLosses);
  console.log("reputation     :", after.reputation.toString());
  console.log("listings_count :", after.listingsCount);

  // The record must be untouched. Assert it rather than eyeballing the print.
  const preserved =
    after.resolvedWins === before.resolvedWins &&
    after.resolvedLosses === before.resolvedLosses &&
    after.reputation.eq(before.reputation) &&
    after.listingsCount === before.listingsCount &&
    after.openedAt.eq(before.openedAt) &&
    after.bondAmount.eq(before.bondAmount);
  if (!preserved) throw new Error("FAIL: the stall record changed; it must not have");
  if (after.uri !== newUri) throw new Error(`FAIL: uri is ${after.uri}, expected ${newUri}`);

  console.log("\nPASS: uri updated, record byte-identical");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
