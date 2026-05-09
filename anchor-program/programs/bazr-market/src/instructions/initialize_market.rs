use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{BOND_VAULT_SEED, MARKET_SEED, MAX_BPS};
use crate::errors::BazrError;
use crate::events::MarketInitialized;
use crate::state::Market;

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Market::LEN,
        seeds = [MARKET_SEED],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Bond escrow. Owned by the market PDA, so only this program can move it.
    #[account(
        init,
        payer = authority,
        seeds = [BOND_VAULT_SEED],
        bump,
        token::mint = bazr_mint,
        token::authority = market,
        token::token_program = token_program,
    )]
    pub bond_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub bazr_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeMarket>,
    stall_bond_amount: u64,
    slash_bps: u16,
    fee_bps: u16,
) -> Result<()> {
    require!(stall_bond_amount > 0, BazrError::InvalidBondAmount);
    require!(slash_bps <= MAX_BPS, BazrError::InvalidBps);
    require!(fee_bps <= MAX_BPS, BazrError::InvalidBps);

    let market = &mut ctx.accounts.market;
    market.authority = ctx.accounts.authority.key();
    market.bazr_mint = ctx.accounts.bazr_mint.key();
    market.bond_vault = ctx.accounts.bond_vault.key();
    market.stall_bond_amount = stall_bond_amount;
    market.total_stalls = 0;
    market.total_listings = 0;
    market.total_crates = 0;
    market.total_resolved_wins = 0;
    market.total_resolved_losses = 0;
    market.total_bond_burned = 0;
    market.slash_bps = slash_bps;
    market.fee_bps = fee_bps;
    market.paused = false;
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.bond_vault;
    market.reserved = [0u8; 65];

    emit!(MarketInitialized {
        market: market.key(),
        authority: market.authority,
        bazr_mint: market.bazr_mint,
        bond_vault: market.bond_vault,
        stall_bond_amount,
        slash_bps,
        fee_bps,
    });

    Ok(())
}
