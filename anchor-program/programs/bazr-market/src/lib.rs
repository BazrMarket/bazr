//! BAZR market program -- the on-chain half of the Solana meme aftermarket.
//!
//! Three records live here:
//!   * `Stall`   a curator's pitch table, backed by a token bond that can be slashed
//!   * `Listing` a meme put back on the table, with the thesis hash committed up front
//!   * `Crate`   a meme basket whose weights always sum to 10000 bps
//!
//! Design rules that are not negotiable, because the product's claim depends on them:
//!   * A stall's losses are stored exactly like its wins (`u32` both, same
//!     reputation step) and both ride in `ListingResolved`, so nothing downstream
//!     can render a wins-only leaderboard cheaply.
//!   * A listing is never deleted. Withdrawing marks it `Withdrawn`.
//!   * A stall account is never deallocated, so a losing record cannot be reset
//!     by closing and reopening at the same PDA.
//!     `set_stall_uri` exists so that a rotted evidence link never becomes a
//!     reason to want that reset; it cannot touch a counter.
//!   * Resolution is an authority action; a stall cannot grade its own calls.
//!   * Every arithmetic operation is checked. `overflow-checks = true` is set in
//!     the workspace release profile as a second line of defence.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::ListingOutcome;

declare_id!("FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb");

#[program]
pub mod bazr_market {
    use super::*;

    /// Create the global config PDA and the bond escrow. Authority only, once.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        stall_bond_amount: u64,
        slash_bps: u16,
        fee_bps: u16,
    ) -> Result<()> {
        instructions::initialize_market::handler(ctx, stall_bond_amount, slash_bps, fee_bps)
    }

    /// Open a stall by escrowing the market's bond.
    pub fn open_stall(ctx: Context<OpenStall>, uri: String) -> Result<()> {
        instructions::open_stall::handler(ctx, uri)
    }

    /// Repoint the stall's evidence link. Touches no counter and no record.
    pub fn set_stall_uri(ctx: Context<SetStallUri>, uri: String) -> Result<()> {
        instructions::set_stall_uri::handler(ctx, uri)
    }

    /// Put a meme on the stall, committing the relic score and thesis hash.
    pub fn list_relic(
        ctx: Context<ListRelic>,
        relic_score_at_listing: u16,
        thesis_hash: [u8; 32],
    ) -> Result<()> {
        instructions::list_relic::handler(ctx, relic_score_at_listing, thesis_hash)
    }

    /// Record how a listing ended. Survived and Faded are recorded alike.
    pub fn resolve_listing(ctx: Context<ResolveListing>, outcome: ListingOutcome) -> Result<()> {
        instructions::resolve_listing::handler(ctx, outcome)
    }

    /// Pull a still-pending listing. The record stays, marked Withdrawn.
    pub fn withdraw_listing(ctx: Context<WithdrawListing>) -> Result<()> {
        instructions::withdraw_listing::handler(ctx)
    }

    /// Return the bond. Refused for a slashed stall or one with pending listings.
    pub fn close_stall(ctx: Context<CloseStall>) -> Result<()> {
        instructions::close_stall::handler(ctx)
    }

    /// Burn `slash_bps` of the bond and return the rest. Permanent mark.
    pub fn slash_stall(ctx: Context<SlashStall>, reason_code: u8) -> Result<()> {
        instructions::slash_stall::handler(ctx, reason_code)
    }

    /// Issue a meme basket. Weights must sum to 10000 bps.
    pub fn create_crate(
        ctx: Context<CreateCrate>,
        crate_id: u64,
        name: String,
        mints: Vec<Pubkey>,
        weights: Vec<u16>,
    ) -> Result<()> {
        instructions::create_crate::handler(ctx, crate_id, name, mints, weights)
    }

    /// Replace a crate's composition. Weights must sum to 10000 bps again.
    pub fn rebalance_crate(
        ctx: Context<RebalanceCrate>,
        mints: Vec<Pubkey>,
        weights: Vec<u16>,
    ) -> Result<()> {
        instructions::rebalance_crate::handler(ctx, mints, weights)
    }

    /// Lock the composition for good.
    pub fn freeze_crate(ctx: Context<FreezeCrate>) -> Result<()> {
        instructions::freeze_crate::handler(ctx)
    }
}
