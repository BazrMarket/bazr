//! Seeds and hard bounds shared by every instruction.
//!
//! Seed byte strings are the single source of truth for PDA derivation. The web
//! client, the indexer and this program must all use the exact same bytes, so
//! nothing here may be changed after the first mainnet deployment.

/// Global config PDA: `["market"]`.
pub const MARKET_SEED: &[u8] = b"market";
/// Bond escrow token account PDA: `["bond_vault"]`.
pub const BOND_VAULT_SEED: &[u8] = b"bond_vault";
/// Stall PDA: `["stall", owner]`.
pub const STALL_SEED: &[u8] = b"stall";
/// Listing PDA: `["listing", stall, mint]`.
pub const LISTING_SEED: &[u8] = b"listing";
/// Crate PDA: `["crate", creator, crate_id_le]`.
pub const CRATE_SEED: &[u8] = b"crate";

/// 100% in basis points.
pub const MAX_BPS: u16 = 10_000;

/// Relic scores are a survival summary on a 0..=1000 scale, never a prediction.
pub const MAX_RELIC_SCORE: u16 = 1_000;

/// Max byte length of the evidence URI a stall owner publishes.
pub const MAX_STALL_URI_LEN: usize = 96;

/// Max byte length of a crate name.
pub const MAX_CRATE_NAME_LEN: usize = 32;

/// Max number of mints a single crate may hold.
pub const MAX_CRATE_MINTS: usize = 16;

/// Reputation moved per resolved listing. A loss subtracts exactly what a win
/// adds: the ledger is not allowed to flatter a stall owner.
pub const REPUTATION_STEP: i64 = 100;
