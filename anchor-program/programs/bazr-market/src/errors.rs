use anchor_lang::prelude::*;

#[error_code]
pub enum BazrError {
    #[msg("Market is paused; no new stalls or listings are accepted")]
    MarketPaused,
    #[msg("Basis points value must be between 0 and 10000")]
    InvalidBps,
    #[msg("Stall bond amount must be greater than zero")]
    InvalidBondAmount,
    #[msg("Bond token balance is below the stall bond required by the market")]
    InsufficientBond,
    #[msg("Token account mint does not match the market bond mint")]
    BondMintMismatch,
    #[msg("Token account owner does not match the stall owner")]
    TokenOwnerMismatch,
    #[msg("Stall has been slashed; it can no longer list, close or reclaim its bond")]
    StallSlashed,
    #[msg("Stall still has unresolved listings; resolve or withdraw them first")]
    StallHasActiveListings,
    #[msg("Stall bond has already been released")]
    BondAlreadyReleased,
    #[msg("Evidence URI exceeds the maximum length of 96 bytes")]
    UriTooLong,
    #[msg("Evidence URI must not be empty")]
    UriEmpty,
    #[msg("Relic score must be between 0 and 1000")]
    RelicScoreOutOfRange,
    #[msg("Thesis hash must not be all zeroes; a listing requires published reasoning")]
    EmptyThesisHash,
    #[msg("Listing is not pending; it has already been resolved or withdrawn")]
    ListingNotPending,
    #[msg("Resolution outcome must be Survived or Faded")]
    InvalidResolution,
    #[msg("Crate name must not be empty")]
    CrateNameEmpty,
    #[msg("Crate name exceeds the maximum length of 32 bytes")]
    CrateNameTooLong,
    #[msg("Crate must hold at least one mint")]
    EmptyBasket,
    #[msg("Crate holds more than the maximum of 16 mints")]
    TooManyMints,
    #[msg("Mint list and weight list must have the same length")]
    BasketLengthMismatch,
    #[msg("Every crate weight must be greater than zero")]
    ZeroWeight,
    #[msg("Crate weights must sum to exactly 10000 basis points")]
    WeightsNotFullyAllocated,
    #[msg("Crate contains the same mint more than once")]
    DuplicateMint,
    #[msg("Crate is frozen; the issuer can no longer rebalance it")]
    CrateFrozen,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
