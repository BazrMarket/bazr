//! Events consumed by the BAZR indexer.
//!
//! Adding a field to an existing event breaks decoding of past logs, because an
//! event has no `reserved` tail the way an account does. If an event ever needs
//! new data, emit a NEW event type instead -- the discriminator then acts as the
//! version -- and make the indexer treat an unknown discriminator from this
//! program as an error rather than skipping it silently.

use anchor_lang::prelude::*;

use crate::state::ListingOutcome;

#[event]
pub struct MarketInitialized {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub bazr_mint: Pubkey,
    pub bond_vault: Pubkey,
    pub stall_bond_amount: u64,
    pub slash_bps: u16,
    pub fee_bps: u16,
}

#[event]
pub struct StallOpened {
    pub stall: Pubkey,
    pub owner: Pubkey,
    pub bond_amount: u64,
    pub uri: String,
    pub opened_at: i64,
    pub total_stalls: u64,
}

/// Carries the URI it replaced, not just the new one. A stall's evidence link
/// is the only mutable field on the account, so a silent overwrite would let a
/// stall swap the reasoning behind its record without leaving a trace. The old
/// value rides along for the same reason `ListingResolved` carries losses next
/// to wins: the unflattering half is not cheaper to drop than to keep.
#[event]
pub struct StallUriUpdated {
    pub stall: Pubkey,
    pub owner: Pubkey,
    pub old_uri: String,
    pub new_uri: String,
    pub updated_at: i64,
}

#[event]
pub struct RelicListed {
    pub listing: Pubkey,
    pub stall: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub relic_score_at_listing: u16,
    pub thesis_hash: [u8; 32],
    pub listed_at: i64,
    pub listings_count: u32,
}

/// Carries both sides of the stall's record. An indexer reading this event can
/// render wins and losses without a second fetch, so there is no cheap path to
/// a leaderboard that shows only the wins.
#[event]
pub struct ListingResolved {
    pub listing: Pubkey,
    pub stall: Pubkey,
    pub mint: Pubkey,
    pub outcome: ListingOutcome,
    pub resolved_at: i64,
    pub stall_resolved_wins: u32,
    pub stall_resolved_losses: u32,
    pub stall_reputation: i64,
}

#[event]
pub struct ListingWithdrawn {
    pub listing: Pubkey,
    pub stall: Pubkey,
    pub mint: Pubkey,
    pub withdrawn_at: i64,
    pub active_listings: u32,
}

#[event]
pub struct StallClosed {
    pub stall: Pubkey,
    pub owner: Pubkey,
    pub bond_returned: u64,
    pub resolved_wins: u32,
    pub resolved_losses: u32,
    pub reputation: i64,
    pub closed_at: i64,
}

#[event]
pub struct StallSlashed {
    pub stall: Pubkey,
    pub owner: Pubkey,
    pub bond_amount: u64,
    pub burned_amount: u64,
    pub returned_amount: u64,
    pub slash_bps: u16,
    pub reason_code: u8,
    pub slashed_at: i64,
}

#[event]
pub struct CrateCreated {
    pub crate_account: Pubkey,
    pub creator: Pubkey,
    pub crate_id: u64,
    pub name: String,
    pub mints: Vec<Pubkey>,
    pub weights: Vec<u16>,
    pub created_at: i64,
}

#[event]
pub struct CrateRebalanced {
    pub crate_account: Pubkey,
    pub creator: Pubkey,
    pub crate_id: u64,
    pub mints: Vec<Pubkey>,
    pub weights: Vec<u16>,
    pub rebalance_count: u32,
    pub last_rebalanced_at: i64,
}

#[event]
pub struct CrateFrozen {
    pub crate_account: Pubkey,
    pub creator: Pubkey,
    pub crate_id: u64,
    pub rebalance_count: u32,
    pub frozen_at: i64,
}
