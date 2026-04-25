use anchor_lang::prelude::*;

/// Global config, PDA `["market"]`. One per deployment.
#[account]
pub struct Market {
    /// Authority allowed to resolve listings, slash stalls and pause the market.
    pub authority: Pubkey,
    /// SPL / Token-2022 mint used for stall bonds.
    pub bazr_mint: Pubkey,
    /// Bond escrow token account, PDA `["bond_vault"]`, owned by this market PDA.
    pub bond_vault: Pubkey,
    /// Bond a stall must escrow to open, in `bazr_mint` base units.
    pub stall_bond_amount: u64,
    /// Stalls currently open (decremented on close).
    pub total_stalls: u64,
    /// Listings ever created (never decremented -- the ledger is append-only).
    pub total_listings: u64,
    /// Crates ever created.
    pub total_crates: u64,
    /// Listings resolved as Survived, across every stall.
    pub total_resolved_wins: u64,
    /// Listings resolved as Faded, across every stall. Same width as wins:
    /// the market-wide failure count is never allowed to be cheaper to store.
    pub total_resolved_losses: u64,
    /// Bond burned by slashing, in `bazr_mint` base units.
    pub total_bond_burned: u64,
    /// Share of a bond burned when a stall is slashed, in basis points.
    pub slash_bps: u16,
    /// Protocol fee in basis points. Reserved for the haggle router; the market
    /// program itself does not charge it.
    pub fee_bps: u16,
    /// When true, `open_stall` and `list_relic` are refused.
    pub paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
    /// Reserved tail + padding: brings LEN to 224 (28 * 8).
    pub reserved: [u8; 65],
}

impl Market {
    pub const LEN: usize = 32 + 32 + 32   // authority, bazr_mint, bond_vault
        + 8 * 7                            // seven u64 counters
        + 2 + 2                            // slash_bps, fee_bps
        + 1 + 1 + 1                        // paused, bump, vault_bump
        + 65; // reserved
}
