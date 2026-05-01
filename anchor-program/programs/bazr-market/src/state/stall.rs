use anchor_lang::prelude::*;

use crate::constants::MAX_STALL_URI_LEN;

/// A curator's pitch table, PDA `["stall", owner]`.
///
/// `resolved_wins` and `resolved_losses` are both `u32` on purpose. BAZR's
/// honesty gate requires a stall's failures to be recorded at the same fidelity
/// as its successes -- a schema that counts only wins cannot be fixed later by
/// the UI, so the constraint lives here in the account layout.
///
/// The account is never deallocated. `close_stall` returns the bond and stamps
/// `closed_at`, but leaves the record in place: the PDA is derived from the
/// owner, so closing-and-reopening would otherwise reset a losing track record
/// to zero.
#[account]
pub struct Stall {
    pub owner: Pubkey,
    /// Bond currently escrowed for this stall. Zero once closed or slashed.
    pub bond_amount: u64,
    /// Bond burned by a slash. Permanent record; never reset.
    pub slashed_amount: u64,
    pub opened_at: i64,
    /// Zero while the stall is open. Set by `close_stall`.
    pub closed_at: i64,
    /// Cumulative reputation: `+REPUTATION_STEP` per win, `-REPUTATION_STEP`
    /// per loss. Signed, because a stall that is wrong more often than it is
    /// right must be able to go below zero.
    pub reputation: i64,
    /// Listings ever created by this stall.
    pub listings_count: u32,
    /// Listings still Pending.
    pub active_listings: u32,
    pub resolved_wins: u32,
    pub resolved_losses: u32,
    /// Permanent mark. A slashed stall can never list again or reclaim a bond.
    pub slashed: bool,
    pub bump: u8,
    /// Link to the stall's published reasoning (kept short: the full text lives
    /// off-chain, its hash is committed per listing).
    pub uri: String,
    /// Reserved tail + padding: brings LEN to 216 (27 * 8).
    pub reserved: [u8; 26],
}

impl Stall {
    pub const LEN: usize = 32           // owner
        + 8 * 5                          // bond_amount, slashed_amount, opened_at, closed_at, reputation
        + 4 * 4                          // listings_count, active_listings, wins, losses
        + 1 + 1                          // slashed, bump
        + 4 + MAX_STALL_URI_LEN          // uri
        + 26; // reserved
}
