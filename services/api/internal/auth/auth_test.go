package auth

import (
	"strings"
	"testing"
)

func TestPasswords(t *testing.T) {
	hash, err := HashPassword("correct-horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("hash = %q", hash)
	}
	other, _ := HashPassword("correct-horse")
	if other == hash {
		t.Fatal("two hashes of one password should differ (random salt)")
	}
	tests := []struct {
		name    string
		hash    string
		pw      string
		want    bool
		wantErr bool
	}{
		{"right password", hash, "correct-horse", true, false},
		{"wrong password", hash, "correct-horsE", false, false},
		{"empty password", hash, "", false, false},
		{"not argon2id", "$2a$10$abc", "x", false, true},
		{"garbage", "nope", "x", false, true},
		{"bad salt", "$argon2id$v=19$m=19456,t=2,p=1$***$AAAA", "x", false, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ok, err := CheckPassword(tt.hash, tt.pw)
			if ok != tt.want || (err != nil) != tt.wantErr {
				t.Fatalf("CheckPassword = %v, %v; want %v, err %v", ok, err, tt.want, tt.wantErr)
			}
		})
	}
}

func TestPasswordRules(t *testing.T) {
	tests := []struct {
		pw   string
		want error
	}{
		{"short", ErrPasswordTooShort},
		{"123456789", ErrPasswordTooShort},
		{"1234567890", nil},
		{"éééééééééé", nil}, // 10 characters, 20 bytes
		{strings.Repeat("a", 257), ErrPasswordTooLong},
	}
	for _, tt := range tests {
		if got := CheckPasswordRules(tt.pw); got != tt.want {
			t.Errorf("CheckPasswordRules(%q) = %v, want %v", tt.pw, got, tt.want)
		}
	}
}

func TestCodesAndTokens(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		c, err := NewCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(c) != 6 || strings.Trim(c, "0123456789") != "" {
			t.Fatalf("code %q is not 6 digits", c)
		}
		seen[c] = true
	}
	if len(seen) < 45 {
		t.Fatalf("only %d distinct codes in 50", len(seen))
	}
	tok, _ := NewToken()
	if len(tok) != 43 {
		t.Fatalf("token %q has length %d, want 43", tok, len(tok))
	}

	h := NewHasher("key-one")
	if !h.Equal("123456", h.Hash("123456")) || h.Equal("123457", h.Hash("123456")) {
		t.Fatal("Equal should match only the same code")
	}
	if NewHasher("key-two").Hash("123456") == h.Hash("123456") {
		t.Fatal("hashes must depend on the key")
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		in   string
		n    int
		want string
	}{
		{"short", 10, "short"},
		{"abcdef", 3, "abc"},
		{"aé", 2, "a"}, // é is 2 bytes; never split it
	}
	for _, tt := range tests {
		if got := truncate(tt.in, tt.n); got != tt.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", tt.in, tt.n, got, tt.want)
		}
	}
}
