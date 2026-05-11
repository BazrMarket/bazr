use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::constants::{BOND_VAULT_SEED, MARKET_SEED, MAX_STALL_URI_LEN, STALL_SEED};
use crate::errors::BazrError;
use crate::events::StallOpened;
use crate::state::{Market, Stall};

#[derive(Accounts)]
pub struct OpenStall<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED],
        bump = market.bump,
        constraint = !market.paused @ BazrError::MarketPaused,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = owner,
        space = 8 + Stall::LEN,
        seeds = [STALL_SEED, owner.key().as_ref()],
        bump,
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
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<OpenStall>, uri: String) -> Result<()> {
    require!(!uri.is_empty(), BazrError::UriEmpty);
    require!(uri.len() <= MAX_STALL_URI_LEN, BazrError::UriTooLong);

    let bond_amount = ctx.accounts.market.stall_bond_amount;
    // Explicit balance gate: the SPL transfer would fail anyway, but a bespoke
    // error tells the caller which of the two failures they hit.
    require!(
        ctx.accounts.owner_token_account.amount >= bond_amount,
        BazrError::InsufficientBond
    );

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_interface::TransferChecked {
                from: ctx.accounts.owner_token_account.to_account_info(),
                mint: ctx.accounts.bazr_mint.to_account_info(),
                to: ctx.accounts.bond_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        bond_amount,
        ctx.accounts.bazr_mint.decimals,
    )?;

    let now = Clock::get()?.unix_timestamp;

    let stall = &mut ctx.accounts.stall;
    stall.owner = ctx.accounts.owner.key();
    stall.bond_amount = bond_amount;
    stall.slashed_amount = 0;
    stall.opened_at = now;
    stall.closed_at = 0;
    stall.reputation = 0;
    stall.listings_count = 0;
    stall.active_listings = 0;
    stall.resolved_wins = 0;
    stall.resolved_losses = 0;
    stall.slashed = false;
    stall.bump = ctx.bumps.stall;
    stall.uri = uri.clone();
    stall.reserved = [0u8; 26];

    let market = &mut ctx.accounts.market;
    market.total_stalls = market
        .total_stalls
        .checked_add(1)
        .ok_or(BazrError::MathOverflow)?;

    emit!(StallOpened {
        stall: ctx.accounts.stall.key(),
        owner: ctx.accounts.owner.key(),
        bond_amount,
        uri,
        opened_at: now,
        total_stalls: ctx.accounts.market.total_stalls,
    });

    Ok(())
}
