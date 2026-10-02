package platform

import (
	"fmt"

	"github.com/valkey-io/valkey-go"
)

func OpenCache(url string) (valkey.Client, error) {
	opts, err := valkey.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse cache url: %w", err)
	}
	client, err := valkey.NewClient(opts)
	if err != nil {
		return nil, fmt.Errorf("open cache: %w", err)
	}
	return client, nil
}
