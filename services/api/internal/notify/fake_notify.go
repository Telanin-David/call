package notify

import (
	"context"
	"sync"
)

// Fake records every message for tests. Set Fail to make sends fail.
type Fake struct {
	mu     sync.Mutex
	Emails []Email
	Texts  []Text
	Fail   error
}

func (f *Fake) SendEmail(_ context.Context, m Email) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail != nil {
		return f.Fail
	}
	f.Emails = append(f.Emails, m)
	return nil
}

func (f *Fake) SendText(_ context.Context, m Text) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail != nil {
		return f.Fail
	}
	f.Texts = append(f.Texts, m)
	return nil
}

// LastEmail returns the newest email to an address.
func (f *Fake) LastEmail(to string) (Email, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.Emails) - 1; i >= 0; i-- {
		if f.Emails[i].To == to {
			return f.Emails[i], true
		}
	}
	return Email{}, false
}

// LastText returns the newest text to a number.
func (f *Fake) LastText(to string) (Text, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.Texts) - 1; i >= 0; i-- {
		if f.Texts[i].To == to {
			return f.Texts[i], true
		}
	}
	return Text{}, false
}
