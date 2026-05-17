use anchor_lang::prelude::*;

use crate::constants::{LISTING_SEED, STALL_SEED};
use crate::errors::BazrError;
use crate::events::ListingWithdrawn;
use crate::state::{Listing, ListingOutcome, Stall};

/// Withdrawing marks the listing `Withdrawn`; it never closes the account.
/// A stall must not be able to erase a call it no longer likes.
#[derive(Accounts)]
pub struct WithdrawListing<'info> {
    #[account(
        mut,
        seeds = [STALL_SEED, owner.key().as_ref()],
        bump = stall.bump,
        has_one = owner,
    )]
    pub stall: Box<Account<'info, Stall>>,

    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [LISTING_SEED, stall.key().as_ref(), listing.mint.as_ref()],
        bump = listing.bump,
        has_one = stall,
    )]
    pub listing: Box<Account<'info, Listing>>,
}

pub fn handler(ctx: Context<WithdrawListing>) -> Result<()> {
    require!(
        ctx.accounts.listing.outcome == ListingOutcome::Pending,
        BazrError::ListingNotPending
    );

    let now = Clock::get()?.unix_timestamp;

    let listing = &mut ctx.accounts.listing;
    listing.outcome = ListingOutcome::Withdrawn;
    listing.resolved_at = now;

    let stall = &mut ctx.accounts.stall;
    stall.active_listings = stall.active_listings.saturating_sub(1);

    emit!(ListingWithdrawn {
        listing: ctx.accounts.listing.key(),
        stall: ctx.accounts.stall.key(),
        mint: ctx.accounts.listing.mint,
        withdrawn_at: now,
        active_listings: ctx.accounts.stall.active_listings,
    });

    Ok(())
}
