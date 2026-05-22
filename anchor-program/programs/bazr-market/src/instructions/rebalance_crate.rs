use anchor_lang::prelude::*;

use crate::constants::CRATE_SEED;
use crate::errors::BazrError;
use crate::events::CrateRebalanced;
use crate::state::{validate_basket, Crate};

#[derive(Accounts)]
pub struct RebalanceCrate<'info> {
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

pub fn handler(ctx: Context<RebalanceCrate>, mints: Vec<Pubkey>, weights: Vec<u16>) -> Result<()> {
    validate_basket(&mints, &weights)?;

    let now = Clock::get()?.unix_timestamp;

    let crate_account = &mut ctx.accounts.crate_account;
    crate_account.mints = mints.clone();
    crate_account.weights = weights.clone();
    crate_account.last_rebalanced_at = now;
    crate_account.rebalance_count = crate_account
        .rebalance_count
        .checked_add(1)
        .ok_or(BazrError::MathOverflow)?;

    emit!(CrateRebalanced {
        crate_account: ctx.accounts.crate_account.key(),
        creator: ctx.accounts.creator.key(),
        crate_id: ctx.accounts.crate_account.crate_id,
        mints,
        weights,
        rebalance_count: ctx.accounts.crate_account.rebalance_count,
        last_rebalanced_at: now,
    });

    Ok(())
}
