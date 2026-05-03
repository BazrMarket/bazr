use anchor_lang::prelude::*;

use crate::constants::{MAX_BPS, MAX_CRATE_MINTS, MAX_CRATE_NAME_LEN};
use crate::errors::BazrError;

/// A meme basket, PDA `["crate", creator, crate_id_le]`.
///
/// The crate is a weighting record only: it holds no user funds and takes no
/// custody. `weights` always sums to 10000 bps, enforced on create and on every
/// rebalance, so a crate can never quietly under-allocate.
#[account]
pub struct Crate {
    pub creator: Pubkey,
    pub crate_id: u64,
    pub created_at: i64,
    /// Equal to `created_at` until the first rebalance.
    pub last_rebalanced_at: i64,
    pub rebalance_count: u32,
    /// Once frozen the composition is final; the issuer cannot rebalance again.
    pub frozen: bool,
    pub bump: u8,
    pub name: String,
    pub mints: Vec<Pubkey>,
    /// Basis points per mint, index-aligned with `mints`, summing to 10000.
    pub weights: Vec<u16>,
    /// Reserved tail + padding: brings LEN to 680 (85 * 8).
    pub reserved: [u8; 30],
}

impl Crate {
    pub const LEN: usize = 32            // creator
        + 8 + 8 + 8                       // crate_id, created_at, last_rebalanced_at
        + 4                               // rebalance_count
        + 1 + 1                           // frozen, bump
        + 4 + MAX_CRATE_NAME_LEN          // name
        + 4 + 32 * MAX_CRATE_MINTS        // mints
        + 4 + 2 * MAX_CRATE_MINTS         // weights
        + 30; // reserved
}

/// Shared composition check for `create_crate` and `rebalance_crate`.
///
/// Both entry points call this: a rebalance that skipped the check could leave
/// a crate whose weights no longer sum to 100%, and nothing downstream would
/// notice because the sum is never recomputed on read.
pub fn validate_basket(mints: &[Pubkey], weights: &[u16]) -> Result<()> {
    require!(!mints.is_empty(), BazrError::EmptyBasket);
    require!(mints.len() <= MAX_CRATE_MINTS, BazrError::TooManyMints);
    require!(
        mints.len() == weights.len(),
        BazrError::BasketLengthMismatch
    );

    let mut total: u32 = 0;
    for (i, weight) in weights.iter().enumerate() {
        require!(*weight > 0, BazrError::ZeroWeight);
        total = total
            .checked_add(u32::from(*weight))
            .ok_or(BazrError::MathOverflow)?;
        for other in mints.iter().skip(i + 1) {
            require_keys_neq!(mints[i], *other, BazrError::DuplicateMint);
        }
    }
    require!(
        total == u32::from(MAX_BPS),
        BazrError::WeightsNotFullyAllocated
    );

    Ok(())
}
