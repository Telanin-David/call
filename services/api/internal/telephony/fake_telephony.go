package telephony

import (
	"context"
	"fmt"
	"sync"
)

// FakeNumbers stands in for the provider in tests and in development
// without a Telnyx key. Every area code has numbers in the 555-0100 to
// 555-0199 range, which are set aside for fiction and never ring anyone.
type FakeNumbers struct {
	mu sync.Mutex
	// Owned are the numbers ordered and not yet released.
	Owned map[string]bool
	// Taken numbers fail to order, as if someone else bought them first.
	Taken map[string]bool
	// Released lists every number given back, in order.
	Released []string
	// Fail makes every call fail, for testing provider outages.
	Fail bool
}

// fakeMonthlyCost is what the fake charges for any number: $1.00.
const fakeMonthlyCost = 1_000_000

var fakeCities = map[string]string{
	"212": "New York, NY", "646": "New York, NY", "917": "New York, NY", "718": "Brooklyn, NY",
	"213": "Los Angeles, CA", "310": "Los Angeles, CA", "305": "Miami, FL", "312": "Chicago, IL",
	"415": "San Francisco, CA", "512": "Austin, TX", "713": "Houston, TX", "404": "Atlanta, GA",
	"416": "Toronto, ON", "647": "Toronto, ON", "604": "Vancouver, BC", "514": "Montreal, QC",
}

func (f *FakeNumbers) Search(_ context.Context, country, areaCode string, limit int) ([]Available, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return nil, ErrProvider
	}
	out := []Available{}
	for i := 0; i < 100 && len(out) < limit; i++ {
		// 7 and 100 share no factor, so this visits all 100 endings once.
		n := fmt.Sprintf("+1%s55501%02d", areaCode, (42+i*7)%100)
		if f.Owned[n] || f.Taken[n] {
			continue
		}
		out = append(out, Available{E164: n, City: fakeCities[areaCode], MonthlyCost: fakeMonthlyCost})
	}
	return out, nil
}

func (f *FakeNumbers) Order(_ context.Context, e164 string) (Ordered, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return Ordered{}, ErrProvider
	}
	if f.Taken[e164] || f.Owned[e164] {
		return Ordered{}, ErrNumberGone
	}
	if f.Owned == nil {
		f.Owned = map[string]bool{}
	}
	f.Owned[e164] = true
	return Ordered{E164: e164, ProviderID: "fake-" + e164[1:], MonthlyCost: fakeMonthlyCost}, nil
}

func (f *FakeNumbers) Release(_ context.Context, e164 string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return ErrProvider
	}
	delete(f.Owned, e164)
	f.Released = append(f.Released, e164)
	return nil
}
