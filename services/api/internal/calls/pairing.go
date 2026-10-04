package calls

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Phone as headset: the laptop shows a 6-digit code (also as a QR code),
// the rep's phone, signed in to the same account, joins with it, and from
// then on calls started "via phone" are dialled and heard on the phone
// while the laptop shows the script. The phone checks in about every
// second while it is open.
const (
	// PairingCodeLife is how long a code can be used to join.
	PairingCodeLife = 10 * time.Minute
	// PairingWrongTries is how many wrong codes end a pairing, so the six
	// digits can't be guessed.
	PairingWrongTries = 5
	// PhoneOnlineWithin: a phone seen this recently is online.
	PhoneOnlineWithin = 6 * time.Second
	// PhoneLostAfter: a call on a phone not seen this long is ended, so
	// nothing is billed for a call nobody can hear.
	PhoneLostAfter = 15 * time.Second
)

// PairingStatus is how the link stands.
type PairingStatus string

const (
	PairingNone    PairingStatus = "none"
	PairingWaiting PairingStatus = "waiting" // code shown, phone not joined
	PairingLinked  PairingStatus = "linked"  // phone joined and checking in
	PairingLost    PairingStatus = "lost"    // phone joined but stopped checking in
)

// Pairing is the rep's open link between laptop and phone.
type Pairing struct {
	ID          string
	Status      PairingStatus
	PhoneName   string
	Muted       bool
	ExpiresAt   time.Time
	PhoneSeenAt *time.Time
	// Call is the live call going through the phone, if any.
	Call *PairedCall
}

// PairedCall is what the phone needs to carry a call.
type PairedCall struct {
	ID          string
	Status      string
	LeadName    string
	From        string
	To          string
	ClientState string
	AnsweredAt  *time.Time
	PricePerMin int64
	// NeedsDial: the laptop started it and the phone hasn't dialled yet.
	NeedsDial bool
}

func pairingHash(salt, code string) string {
	sum := sha256.Sum256([]byte(salt + ":" + code))
	return hex.EncodeToString(sum[:])
}

func sixDigits() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("make code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// CreatePairing makes a new code for the rep's phone, replacing any open
// link. Starter and Pro only; a call going through the old phone is ended.
func (s *Service) CreatePairing(ctx context.Context, u auth.User) (Pairing, string, error) {
	sub, ok, err := plans.Current(ctx, s.DB, u.ID)
	if err != nil {
		return Pairing{}, "", err
	}
	if !ok || sub.PlanID == plans.Free {
		return Pairing{}, "", ErrPairingPlan
	}
	if err := s.EndPairing(ctx, u.ID); err != nil && !errors.Is(err, ErrNotPaired) {
		return Pairing{}, "", err
	}
	code, err := sixDigits()
	if err != nil {
		return Pairing{}, "", err
	}
	now := s.now()
	var p Pairing
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO pairings (user_id, code_hash, created_at, expires_at) VALUES ($1, '', $2, $3) RETURNING id`,
			u.ID, now, now.Add(PairingCodeLife)).Scan(&p.ID); err != nil {
			return fmt.Errorf("create pairing: %w", err)
		}
		// The pairing's own id salts the hash.
		_, err := tx.Exec(ctx, `UPDATE pairings SET code_hash = $2 WHERE id = $1`, p.ID, pairingHash(p.ID, code))
		return err
	})
	if err != nil {
		return Pairing{}, "", err
	}
	p.Status, p.ExpiresAt = PairingWaiting, now.Add(PairingCodeLife)
	return p, code, nil
}

// JoinPairing links the phone the rep is using with the code from their
// laptop. Only the rep's own open code works; too many wrong codes end it.
func (s *Service) JoinPairing(ctx context.Context, u auth.User, code, phoneName string) (Pairing, error) {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	phoneName = strings.TrimSpace(phoneName)
	if utf8.RuneCountInString(phoneName) > 60 {
		phoneName = string([]rune(phoneName)[:60])
	}
	now := s.now()
	wrong := false
	err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var id, hash string
		var tries int
		var expires time.Time
		var joined *time.Time
		err := tx.QueryRow(ctx, `SELECT id, code_hash, wrong_tries, expires_at, joined_at FROM pairings WHERE user_id = $1 AND ended_at IS NULL FOR UPDATE`,
			u.ID).Scan(&id, &hash, &tries, &expires, &joined)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPairingCode
		}
		if err != nil {
			return fmt.Errorf("read pairing: %w", err)
		}
		if joined != nil || now.After(expires) || tries >= PairingWrongTries {
			return ErrPairingCode
		}
		if pairingHash(id, code) != hash {
			if _, err := tx.Exec(ctx, `UPDATE pairings SET wrong_tries = wrong_tries + 1,
				ended_at = CASE WHEN wrong_tries + 1 >= $2 THEN $3::timestamptz ELSE NULL END WHERE id = $1`, id, PairingWrongTries, now); err != nil {
				return fmt.Errorf("count wrong code: %w", err)
			}
			// Commit the count; the rep is told after.
			wrong = true
			return nil
		}
		_, err = tx.Exec(ctx, `UPDATE pairings SET joined_at = $2, phone_seen_at = $2, phone_name = $3 WHERE id = $1`, id, now, phoneName)
		return err
	})
	if err != nil {
		return Pairing{}, err
	}
	if wrong {
		// Counted; the rep sees the same message as for an old code.
		return Pairing{}, ErrPairingCode
	}
	return s.PairingState(ctx, u.ID, true)
}

// PairingState reads the rep's open link. fromPhone counts as the phone
// checking in. When the phone has been gone too long, a call going through
// it is ended here as well as by the ticker.
func (s *Service) PairingState(ctx context.Context, userID string, fromPhone bool) (Pairing, error) {
	now := s.now()
	if fromPhone {
		if _, err := s.DB.Exec(ctx, `UPDATE pairings SET phone_seen_at = $2 WHERE user_id = $1 AND ended_at IS NULL AND joined_at IS NOT NULL`, userID, now); err != nil {
			return Pairing{}, fmt.Errorf("phone check-in: %w", err)
		}
	}
	var p Pairing
	var joined *time.Time
	err := s.DB.QueryRow(ctx, `SELECT id, phone_name, muted, expires_at, phone_seen_at, joined_at FROM pairings WHERE user_id = $1 AND ended_at IS NULL`,
		userID).Scan(&p.ID, &p.PhoneName, &p.Muted, &p.ExpiresAt, &p.PhoneSeenAt, &joined)
	if errors.Is(err, pgx.ErrNoRows) {
		return Pairing{Status: PairingNone}, nil
	}
	if err != nil {
		return Pairing{}, fmt.Errorf("read pairing: %w", err)
	}
	switch {
	case joined == nil && now.After(p.ExpiresAt):
		return Pairing{Status: PairingNone}, nil
	case joined == nil:
		p.Status = PairingWaiting
	case p.PhoneSeenAt != nil && p.PhoneSeenAt.After(now.Add(-PhoneOnlineWithin)):
		p.Status = PairingLinked
	default:
		p.Status = PairingLost
	}

	c, err := scanCall(s.DB.QueryRow(ctx, `SELECT `+callCols+callFrom+`WHERE c.pairing_id = $1 AND c.status <> 'ended'`, p.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return Pairing{}, fmt.Errorf("read paired call: %w", err)
	}
	if p.PhoneSeenAt == nil || p.PhoneSeenAt.Before(now.Add(-PhoneLostAfter)) {
		if err := s.endNow(ctx, c, now, "phone_lost"); err != nil {
			return Pairing{}, err
		}
		return p, nil
	}
	var name string
	_ = s.DB.QueryRow(ctx, `SELECT `+leadName+` FROM leads l WHERE l.id::text = $1`, c.LeadID).Scan(&name)
	p.Call = &PairedCall{
		ID: c.ID, Status: c.Status, LeadName: name, From: c.FromNumber, To: c.To, ClientState: c.ClientState,
		AnsweredAt: c.AnsweredAt, PricePerMin: c.PricePerMin, NeedsDial: c.Status == "dialing" && c.ProviderID == "",
	}
	return p, nil
}

// SetPairingMuted mutes or unmutes the phone from the laptop.
func (s *Service) SetPairingMuted(ctx context.Context, userID string, muted bool) error {
	tag, err := s.DB.Exec(ctx, `UPDATE pairings SET muted = $2 WHERE user_id = $1 AND ended_at IS NULL AND joined_at IS NOT NULL`, userID, muted)
	if err != nil {
		return fmt.Errorf("mute: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotPaired
	}
	return nil
}

// EndPairing unlinks the phone, from either side. A call going through it
// is ended.
func (s *Service) EndPairing(ctx context.Context, userID string) error {
	now := s.now()
	var id string
	err := s.DB.QueryRow(ctx, `UPDATE pairings SET ended_at = $2 WHERE user_id = $1 AND ended_at IS NULL RETURNING id`, userID, now).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotPaired
	}
	if err != nil {
		return fmt.Errorf("end pairing: %w", err)
	}
	c, err := scanCall(s.DB.QueryRow(ctx, `SELECT `+callCols+callFrom+`WHERE c.pairing_id = $1 AND c.status <> 'ended'`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read paired call: %w", err)
	}
	return s.endNow(ctx, c, now, "phone_unlinked")
}

// endLostPhones ends calls whose phone stopped checking in (the ticker).
func (s *Service) endLostPhones(ctx context.Context, now time.Time, res *TickResult) error {
	rows, err := s.DB.Query(ctx, `SELECT `+callCols+callFrom+`JOIN pairings p ON p.id = c.pairing_id
		WHERE c.status <> 'ended' AND (p.phone_seen_at IS NULL OR p.phone_seen_at < $1)`, now.Add(-PhoneLostAfter))
	if err != nil {
		return fmt.Errorf("find lost phones: %w", err)
	}
	lost, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Call, error) { return scanCall(r) })
	if err != nil {
		return fmt.Errorf("find lost phones: %w", err)
	}
	for _, c := range lost {
		if err := s.endNow(ctx, c, now, "phone_lost"); err != nil {
			return err
		}
		res.Ended++
	}
	return nil
}
