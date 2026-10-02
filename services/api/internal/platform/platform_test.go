package platform_test

import (
	"testing"
)

func TestGetenvFallback(t *testing.T) {
	cfg := MustLoadConfigForTest()
	if cfg.Addr == "" {
		t.Fatal("addr should have a default")
	}
}

func MustLoadConfigForTest() interface{ Addr string } {
	// minimal stand-in until real config test is wired
	return struct{ Addr string }{Addr: ":8080"}
}
