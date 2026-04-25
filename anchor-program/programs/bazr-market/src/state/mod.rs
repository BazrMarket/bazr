//! On-chain accounts. Every `LEN` is written as an explicit field-by-field sum
//! and padded so that `8 + LEN` lands on an 8-byte boundary.
//!
//! Each account ends in a `reserved` tail so that later releases can add fields
//! without migrating existing accounts. A field added out of that tail must be
//! a lifetime accumulator that legitimately starts at zero -- a field holding
//! a *current* total would read 0 on pre-existing accounts and under-report.

pub mod bazr_crate;
pub mod listing;
pub mod market;
pub mod stall;

pub use bazr_crate::*;
pub use listing::*;
pub use market::*;
pub use stall::*;
