use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::constants::{BOND_VAULT_SEED, MARKET_SEED, STALL_SEED};
use crate::errors::BazrError;
use crate::events::StallClosed;
use crate::state::{Market, Stall};

/// Returns the escrowed bond and stamps `closed_at`.
///
/// The stall account is deliberately NOT deallocated. Its PDA is derived from
/// the owner, so closing with `close = owner` would let a stall with a losing
/// record reopen at the same address with the counters back at zero.
#[derive(Accounts)]
pub struct CloseStall<'info> {
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [STALL_SEED, owner.key().as_ref()],
        bump = stall.bump,
        has_one = owner,
        constraint = !stall.slashed @ BazrError::StallSlashed,
        constraint = stall.closed_at == 0 @ BazrError::BondAlreadyReleased,
        constraint = stall.active_listings == 0 @ BazrError::StallHasActiveListings,
    )]
    pub stall: Box<Account<'info, Stall>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        constraint = bazr_mint.key() == market.bazr_mint @ BazrError::BondMintMismatch,
    )]
    pub bazr_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = owner_token_account.mint == market.bazr_mint @ BazrError::BondMintMismatch,
        constraint = owner_token_account.owner == owner.key() @ BazrError::TokenOwnerMismatch,
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [BOND_VAULT_SEED],
        bump = market.vault_bump,
        constraint = bond_vault.key() == market.bond_vault @ BazrError::BondMintMismatch,
    )]
    pub bond_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CloseStall>) -> Result<()> {
    let bond_amount = ctx.accounts.stall.bond_amount;
    require!(bond_amount > 0, BazrError::BondAlreadyReleased);

    let market_bump = ctx.accounts.market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[MARKET_SEED, &[market_bump]]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::TransferChecked {
                from: ctx.accounts.bond_vault.to_account_info(),
                mint: ctx.accounts.bazr_mint.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        bond_amount,
        ctx.accounts.bazr_mint.decimals,
    )?;

    let now = Clock::get()?.unix_timestamp;

    let stall = &mut ctx.accounts.stall;
    stall.bond_amount = 0;
    stall.closed_at = now;

    let market = &mut ctx.accounts.market;
    market.total_stalls = market
        .total_stalls
        .checked_sub(1)
        .ok_or(BazrError::MathOverflow)?;

    emit!(StallClosed {
        stall: ctx.accounts.stall.key(),
        owner: ctx.accounts.owner.key(),
        bond_returned: bond_amount,
        resolved_wins: ctx.accounts.stall.resolved_wins,
        resolved_losses: ctx.accounts.stall.resolved_losses,
        reputation: ctx.accounts.stall.reputation,
        closed_at: now,
    });

    Ok(())
}
