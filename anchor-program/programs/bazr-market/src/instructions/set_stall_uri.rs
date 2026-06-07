use anchor_lang::prelude::*;

use crate::constants::{MAX_STALL_URI_LEN, STALL_SEED};
use crate::errors::BazrError;
use crate::events::StallUriUpdated;
use crate::state::Stall;

/// Repoint a stall's published-reasoning link.
///
/// This is the only field on `Stall` that may change after `open_stall`, and it
/// touches no counter: `resolved_wins`, `resolved_losses` and `reputation` are
/// not readable or writable from here. That separation is the point. A link can
/// rot -- a domain lapses, a host moves -- and without this instruction the only
/// way to correct one would be to close the stall and open a new one, which the
/// account layout deliberately forbids precisely so a losing record cannot be
/// reset. Making the URI mutable is what keeps the record immutable.
///
/// It costs nothing in integrity, because the URI was never the commitment: the
/// per-listing `thesis_hash` is, and it is fixed before the outcome is known.
/// The page behind any URI can be rewritten off chain at any time, so freezing
/// the pointer would buy the appearance of tamper-resistance and none of it.
///
/// A slashed stall is refused, matching `list_relic` and `close_stall` -- a
/// slash ends the stall's ability to act on its own record. A closed stall is
/// allowed: its record is already final and unreachable evidence serves nobody.
#[derive(Accounts)]
pub struct SetStallUri<'info> {
    #[account(
        mut,
        seeds = [STALL_SEED, owner.key().as_ref()],
        bump = stall.bump,
        has_one = owner,
        constraint = !stall.slashed @ BazrError::StallSlashed,
    )]
    pub stall: Box<Account<'info, Stall>>,

    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<SetStallUri>, uri: String) -> Result<()> {
    require!(!uri.is_empty(), BazrError::UriEmpty);
    require!(uri.len() <= MAX_STALL_URI_LEN, BazrError::UriTooLong);

    let now = Clock::get()?.unix_timestamp;

    let stall = &mut ctx.accounts.stall;
    let old_uri = core::mem::replace(&mut stall.uri, uri.clone());

    emit!(StallUriUpdated {
        stall: ctx.accounts.stall.key(),
        owner: ctx.accounts.owner.key(),
        old_uri,
        new_uri: uri,
        updated_at: now,
    });

    Ok(())
}
