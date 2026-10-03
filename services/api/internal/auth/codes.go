package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"
)

// Hasher turns codes and tokens into keyed hashes for storage, so a copy of
// the database alone can't be used to guess 6-digit codes offline.
type Hasher struct{ key []byte }

// NewHasher keys the hashes with the server's secret (SESSION_KEY).
func NewHasher(key string) Hasher { return Hasher{key: []byte(key)} }

// Hash returns the hex HMAC-SHA256 of s.
func (h Hasher) Hash(s string) string {
	m := hmac.New(sha256.New, h.key)
	m.Write([]byte(s))
	return hex.EncodeToString(m.Sum(nil))
}

// Equal compares a code with a stored hash in constant time.
func (h Hasher) Equal(code, hash string) bool {
	return hmac.Equal([]byte(h.Hash(code)), []byte(hash))
}

// NewCode returns a random 6-digit code, "000000" to "999999".
func NewCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// NewToken returns 32 random bytes, URL-safe, for links and session cookies.
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
