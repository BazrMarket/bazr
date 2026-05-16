use anchor_lang::prelude::*;

use crate::constants::{LISTING_SEED, MARKET_SEED, REPUTATION_STEP, STALL_SEED};
use crate::errors::BazrError;
use crate::events::ListingResolved;
use crate::state::{Listing, ListingOutcome, Market, Stall};

/// Resolution is an authority action, not a stall action. A stall owner grading
/// their own calls would make the win/loss record worthless.
#[derive(Accounts)]
pub struct ResolveListing<'info> {
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
    )]
    pub stall: Box<Account<'info, Stall>>,

    #[account(
        mut,
        seeds = [LISTING_SEED, stall.key().as_ref(), listing.mint.as_ref()],
        bump = listing.bump,
        has_one = stall,
    )]
    pub listing: Box<Account<'info, Listing>>,
}

pub fn handler(ctx: Context<ResolveListing>, outcome: ListingOutcome) -> Result<()> {
    require!(
        ctx.accounts.listing.outcome == ListingOutcome::Pending,
        BazrError::ListingNotPending
    );
    require!(
        outcome == ListingOutcome::Survived || outcome == ListingOutcome::Faded,
        BazrError::InvalidResolution
    );

    let now = Clock::get()?.unix_timestamp;

    let listing = &mut ctx.accounts.listing;
    listing.outcome = outcome;
    listing.resolved_at = now;

    let stall = &mut ctx.accounts.stall;
    // Wins and losses move the same counter width and the same reputation step.
    match outcome {
        ListingOutcome::Survived => {
            stall.resolved_wins = stall
                .resolved_wins
                .checked_add(1)
                .ok_or(BazrError::MathOverflow)?;
            stall.reputation = stall
                .reputation
                .checked_add(REPUTATION_STEP)
                .ok_or(BazrError::MathOverflow)?;
        }
        ListingOutcome::Faded => {
            stall.resolved_losses = stall
                .resolved_losses
                .checked_add(1)
                .ok_or(BazrError::MathOverflow)?;
            stall.reputation = stall
                .reputation
                .checked_sub(REPUTATION_STEP)
                .ok_or(BazrError::MathOverflow)?;
        }
        _ => return err!(BazrError::InvalidResolution),
    }
    stall.active_listings = stall.active_listings.saturating_sub(1);

    let market = &mut ctx.accounts.market;
    match outcome {
        ListingOutcome::Survived => {
            market.total_resolved_wins = market
                .total_resolved_wins
                .checked_add(1)
                .ok_or(BazrError::MathOverflow)?;
        }
        ListingOutcome::Faded => {
            market.total_resolved_losses = market
                .total_resolved_losses
                .checked_add(1)
                .ok_or(BazrError::MathOverflow)?;
        }
        _ => return err!(BazrError::InvalidResolution),
    }

    emit!(ListingResolved {
        listing: ctx.accounts.listing.key(),
        stall: ctx.accounts.stall.key(),
        mint: ctx.accounts.listing.mint,
        outcome,
        resolved_at: now,
        stall_resolved_wins: ctx.accounts.stall.resolved_wins,
        stall_resolved_losses: ctx.accounts.stall.resolved_losses,
        stall_reputation: ctx.accounts.stall.reputation,
    });

    Ok(())
}
