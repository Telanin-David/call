// Package auth holds the building blocks for signing in: password hashing,
// one-time codes, and session cookies. The account flows that use them
// (sign up, confirm, reset) live in package accounts.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Argon2id settings from the OWASP password storage guide (19 MiB, 2 passes).
const (
	argonMemory  = 19 * 1024
	argonTime    = 2
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16
)

// MinPasswordLen matches the sign-up screen ("At least 10 characters").
const MinPasswordLen = 10

// maxPasswordLen stops very long inputs from costing hashing time.
const maxPasswordLen = 256

var (
	ErrPasswordTooShort = fmt.Errorf("auth: password must be at least %d characters", MinPasswordLen)
	ErrPasswordTooLong  = fmt.Errorf("auth: password must be at most %d characters", maxPasswordLen)
	errBadHash          = errors.New("auth: malformed password hash")
)

// CheckPasswordRules reports whether a new password is acceptable.
func CheckPasswordRules(password string) error {
	n := utf8.RuneCountInString(password)
	if n < MinPasswordLen {
		return ErrPasswordTooShort
	}
	if n > maxPasswordLen {
		return ErrPasswordTooLong
	}
	return nil
}

// HashPassword returns an Argon2id hash in the standard PHC string form.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// CheckPassword reports whether password matches hash, in constant time.
func CheckPassword(hash, password string) (bool, error) {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errBadHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, errBadHash
	}
	var mem, iters uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &iters, &threads); err != nil {
		return false, errBadHash
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false, errBadHash
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false, errBadHash
	}
	got := argon2.IDKey([]byte(password), salt, iters, mem, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// dummyHash is checked against when no account matches a sign-in, so a
// wrong email takes as long as a wrong password.
var dummyHash = func() string {
	h, err := HashPassword("not-a-real-password")
	if err != nil {
		panic(err)
	}
	return h
}()

// BurnPasswordCheck spends the same time as CheckPassword on a real hash.
func BurnPasswordCheck(password string) {
	_, _ = CheckPassword(dummyHash, password)
}
