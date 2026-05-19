use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::constants::{BOND_VAULT_SEED, MARKET_SEED, MAX_BPS, STALL_SEED};
use crate::errors::BazrError;
use crate::events::StallSlashed;
use crate::state::{Market, Stall};

/// Authority action taken when a stall is caught manipulating.
///
/// `slash_bps` of the bond is burned outright (a real SPL burn, so total supply
/// drops and the loss is verifiable on chain) and the remainder is returned.
/// `slashed = true` is permanent: the stall can never list, close or reclaim
/// a bond again, and the mark stays visible next to its win/loss record.
#[derive(Accounts)]
pub struct SlashStall<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, Market>>,

    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STALL_SEED, stall.owner.as_ref()],
        bump = stall.bump,
        constraint = !stall.slashed @ BazrError::StallSlashed,
        constraint = stall.bond_amount > 0 @ BazrError::BondAlreadyReleased,
    )]
    pub stall: Box<Account<'info, Stall>>,

    /// Must be `mut`: an SPL burn CPI reduces supply on the mint account.
    #[account(
        mut,
        constraint = bazr_mint.key() == market.bazr_mint @ BazrError::BondMintMismatch,
    )]
    pub bazr_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = owner_token_account.mint == market.bazr_mint @ BazrError::BondMintMismatch,
        constraint = owner_token_account.owner == stall.owner @ BazrError::TokenOwnerMismatch,
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

pub fn handler(ctx: Context<SlashStall>, reason_code: u8) -> Result<()> {
    let bond_amount = ctx.accounts.stall.bond_amount;
    let slash_bps = ctx.accounts.market.slash_bps;
    require!(slash_bps <= MAX_BPS, BazrError::InvalidBps);

    // Widen to u128 before multiplying: bond * 10000 overflows u64 for large bonds.
    let burn_amount = u128::from(bond_amount)
        .checked_mul(u128::from(slash_bps))
        .ok_or(BazrError::MathOverflow)?
        .checked_div(u128::from(MAX_BPS))
        .ok_or(BazrError::MathOverflow)?;
    let burn_amount = u64::try_from(burn_amount).map_err(|_| error!(BazrError::MathOverflow))?;
    let return_amount = bond_amount
        .checked_sub(burn_amount)
        .ok_or(BazrError::MathOverflow)?;

    let market_bump = ctx.accounts.market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[MARKET_SEED, &[market_bump]]];
    let decimals = ctx.accounts.bazr_mint.decimals;

    if burn_amount > 0 {
        token_interface::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token_interface::Burn {
                    mint: ctx.accounts.bazr_mint.to_account_info(),
                    from: ctx.accounts.bond_vault.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            ),
            burn_amount,
        )?;
    }

    if return_amount > 0 {
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
            return_amount,
            decimals,
        )?;
    }

    let now = Clock::get()?.unix_timestamp;

    let stall = &mut ctx.accounts.stall;
    stall.slashed = true;
    stall.slashed_amount = burn_amount;
    stall.bond_amount = 0;

    let market = &mut ctx.accounts.market;
    market.total_bond_burned = market
        .total_bond_burned
        .checked_add(burn_amount)
        .ok_or(BazrError::MathOverflow)?;
    market.total_stalls = market.total_stalls.saturating_sub(1);

    emit!(StallSlashed {
        stall: ctx.accounts.stall.key(),
        owner: ctx.accounts.stall.owner,
        bond_amount,
        burned_amount: burn_amount,
        returned_amount: return_amount,
        slash_bps,
        reason_code,
        slashed_at: now,
    });

    Ok(())
}
