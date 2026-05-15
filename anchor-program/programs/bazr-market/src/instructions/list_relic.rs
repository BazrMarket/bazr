use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::{LISTING_SEED, MARKET_SEED, MAX_RELIC_SCORE, STALL_SEED};
use crate::errors::BazrError;
use crate::events::RelicListed;
use crate::state::{Listing, ListingOutcome, Market, Stall};

#[derive(Accounts)]
pub struct ListRelic<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED],
        bump = market.bump,
        constraint = !market.paused @ BazrError::MarketPaused,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [STALL_SEED, owner.key().as_ref()],
        bump = stall.bump,
        has_one = owner,
        constraint = !stall.slashed @ BazrError::StallSlashed,
        constraint = stall.closed_at == 0 @ BazrError::BondAlreadyReleased,
    )]
    pub stall: Box<Account<'info, Stall>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// The meme being put back on the table.
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = owner,
        space = 8 + Listing::LEN,
        seeds = [LISTING_SEED, stall.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub listing: Box<Account<'info, Listing>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ListRelic>,
    relic_score_at_listing: u16,
    thesis_hash: [u8; 32],
) -> Result<()> {
    require!(
        relic_score_at_listing <= MAX_RELIC_SCORE,
        BazrError::RelicScoreOutOfRange
    );
    // A listing without published reasoning is not a listing. The hash is
    // committed now so the thesis cannot be rewritten once the outcome is known.
    require!(thesis_hash != [0u8; 32], BazrError::EmptyThesisHash);

    let now = Clock::get()?.unix_timestamp;

    let listing = &mut ctx.accounts.listing;
    listing.stall = ctx.accounts.stall.key();
    listing.mint = ctx.accounts.mint.key();
    listing.thesis_hash = thesis_hash;
    listing.listed_at = now;
    listing.resolved_at = 0;
    listing.relic_score_at_listing = relic_score_at_listing;
    listing.outcome = ListingOutcome::Pending;
    listing.bump = ctx.bumps.listing;
    listing.reserved = [0u8; 36];

    let stall = &mut ctx.accounts.stall;
    stall.listings_count = stall
        .listings_count
        .checked_add(1)
        .ok_or(BazrError::MathOverflow)?;
    stall.active_listings = stall
        .active_listings
        .checked_add(1)
        .ok_or(BazrError::MathOverflow)?;

    let market = &mut ctx.accounts.market;
    market.total_listings = market
        .total_listings
        .checked_add(1)
        .ok_or(BazrError::MathOverflow)?;

    emit!(RelicListed {
        listing: ctx.accounts.listing.key(),
        stall: ctx.accounts.stall.key(),
        owner: ctx.accounts.owner.key(),
        mint: ctx.accounts.mint.key(),
        relic_score_at_listing,
        thesis_hash,
        listed_at: now,
        listings_count: ctx.accounts.stall.listings_count,
    });

    Ok(())
}
