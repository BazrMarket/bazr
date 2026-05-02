use anchor_lang::prelude::*;

/// How a listing ended. `Pending` is the only state that can still change.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ListingOutcome {
    /// Still on the table.
    Pending,
    /// Resolved in the stall's favour.
    Survived,
    /// Resolved against the stall. Recorded exactly like a win, never hidden.
    Faded,
    /// Pulled by the stall owner before resolution. Counts as neither.
    Withdrawn,
}

/// A meme put on a stall, PDA `["listing", stall, mint]`.
///
/// The record is never deleted. Withdrawing sets `Withdrawn` rather than closing
/// the account, so a stall cannot erase a call it no longer likes.
#[account]
pub struct Listing {
    pub stall: Pubkey,
    pub mint: Pubkey,
    /// Hash of the off-chain thesis text, committed at listing time so the
    /// reasoning cannot be rewritten after the outcome is known.
    pub thesis_hash: [u8; 32],
    pub listed_at: i64,
    /// Zero while Pending.
    pub resolved_at: i64,
    /// Relic score at listing time, 0..=1000. A survival summary, not a forecast.
    pub relic_score_at_listing: u16,
    pub outcome: ListingOutcome,
    pub bump: u8,
    /// Reserved tail + padding: brings LEN to 152 (19 * 8).
    pub reserved: [u8; 36],
}

impl Listing {
    pub const LEN: usize = 32 + 32 + 32  // stall, mint, thesis_hash
        + 8 + 8                           // listed_at, resolved_at
        + 2                               // relic_score_at_listing
        + 1                               // outcome
        + 1                               // bump
        + 36; // reserved
}
