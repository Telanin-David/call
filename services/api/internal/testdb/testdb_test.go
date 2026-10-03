package testdb

import "testing"

func TestNewUserIsUnique(t *testing.T) {
	pool := Pool(t)
	a, b := NewUser(t, pool), NewUser(t, pool)
	if a == "" || a == b {
		t.Fatalf("NewUser returned %q and %q, want two different ids", a, b)
	}
}
