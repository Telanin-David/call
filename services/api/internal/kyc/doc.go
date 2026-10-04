// Package kyc runs the ID check: a rep sends a photo of their ID and a
// selfie, the provider (Smile ID) compares them, and an approved check lifts
// the new-account limits. The provider's callback is only a hint to look:
// the result is always read back from the provider itself, so a forged or
// replayed callback can't approve anyone.
package kyc
