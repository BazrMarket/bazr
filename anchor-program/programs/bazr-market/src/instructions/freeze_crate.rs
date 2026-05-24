use anchor_lang::prelude::*;

use crate::constants::CRATE_SEED;
use crate::errors::BazrError;
use crate::events::CrateFrozen;
use crate::state::Crate;

/// One-way switch. Once frozen the issuer can no longer change the composition,
/// which is what makes a crate's published weighting a commitment rather than
/// a suggestion.
#[derive(Accounts)]
pub struct FreezeCrate<'info> {
    #[account(
        mut,
        seeds = [CRATE_SEED, creator.key().as_ref(), &crate_account.crate_id.to_le_bytes()],
        bump = crate_account.bump,
        has_one = creator,
        constraint = !crate_account.frozen @ BazrError::CrateFrozen,
    )]
    pub crate_account: Box<Account<'info, Crate>>,

    pub creator: Signer<'info>,
}

pub fn handler(ctx: Context<FreezeCrate>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let crate_account = &mut ctx.accounts.crate_account;
    crate_account.frozen = true;

    emit!(CrateFrozen {
        crate_account: ctx.accounts.crate_account.key(),
        creator: ctx.accounts.creator.key(),
        crate_id: ctx.accounts.crate_account.crate_id,
        rebalance_count: ctx.accounts.crate_account.rebalance_count,
        frozen_at: now,
    });

    Ok(())
}
