use anchor_lang::prelude::*;

use crate::constants::{CRATE_SEED, MARKET_SEED, MAX_CRATE_NAME_LEN};
use crate::errors::BazrError;
use crate::events::CrateCreated;
use crate::state::{validate_basket, Crate, Market};

#[derive(Accounts)]
#[instruction(crate_id: u64)]
pub struct CreateCrate<'info> {
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Crate::LEN,
        seeds = [CRATE_SEED, creator.key().as_ref(), &crate_id.to_le_bytes()],
        bump,
    )]
    pub crate_account: Box<Account<'info, Crate>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateCrate>,
    crate_id: u64,
    name: String,
    mints: Vec<Pubkey>,
    weights: Vec<u16>,
) -> Result<()> {
    require!(!name.is_empty(), BazrError::CrateNameEmpty);
    require!(
        name.len() <= MAX_CRATE_NAME_LEN,
        BazrError::CrateNameTooLong
    );
    validate_basket(&mints, &weights)?;

    let now = Clock::get()?.unix_timestamp;

    let crate_account = &mut ctx.accounts.crate_account;
    crate_account.creator = ctx.accounts.creator.key();
    crate_account.crate_id = crate_id;
    crate_account.created_at = now;
    crate_account.last_rebalanced_at = now;
    crate_account.rebalance_count = 0;
    crate_account.frozen = false;
    crate_account.bump = ctx.bumps.crate_account;
    crate_account.name = name.clone();
    crate_account.mints = mints.clone();
    crate_account.weights = weights.clone();
    crate_account.reserved = [0u8; 30];

    let market = &mut ctx.accounts.market;
    market.total_crates = market
        .total_crates
        .checked_add(1)
        .ok_or(BazrError::MathOverflow)?;

    emit!(CrateCreated {
        crate_account: ctx.accounts.crate_account.key(),
        creator: ctx.accounts.creator.key(),
        crate_id,
        name,
        mints,
        weights,
        created_at: now,
    });

    Ok(())
}
