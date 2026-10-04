package calls

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/telanin-david/call/services/api/internal/telephony"
)

func TestPairing(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	db := e.svc.DB

	t.Run("Free can't link a phone", func(t *testing.T) {
		if _, _, err := e.svc.CreatePairing(ctx, u); !errors.Is(err, ErrPairingPlan) {
			t.Fatalf("free: %v", err)
		}
	})
	if _, err := db.Exec(ctx, `INSERT INTO subscriptions (user_id, plan_id, next_renewal) VALUES ($1, 'starter', '2026-11-05')`, u.ID); err != nil {
		t.Fatal(err)
	}

	p, code, err := e.svc.CreatePairing(ctx, u)
	if err != nil || len(code) != 6 || p.Status != PairingWaiting {
		t.Fatalf("create = %+v %q, %v", p, code, err)
	}
	var stored string
	_ = db.QueryRow(ctx, `SELECT code_hash FROM pairings WHERE id = $1`, p.ID).Scan(&stored)
	if stored == code || stored == "" {
		t.Errorf("code stored as %q", stored)
	}

	t.Run("calling via phone before it joins is refused", func(t *testing.T) {
		if _, err := e.svc.StartVia(ctx, u, e.lead(u.ID, list, "+12125550801", "Ann"), true); !errors.Is(err, ErrPhoneNotLinked) {
			t.Fatalf("not joined: %v", err)
		}
	})

	t.Run("another rep can't use the code", func(t *testing.T) {
		other, _ := e.rep(0)
		if _, err := e.svc.JoinPairing(ctx, other, code, "Their phone"); !errors.Is(err, ErrPairingCode) {
			t.Fatalf("other rep: %v", err)
		}
	})

	t.Run("join, then call through the phone", func(t *testing.T) {
		wrong := "000000"
		if code == wrong {
			wrong = "111111"
		}
		if _, err := e.svc.JoinPairing(ctx, u, wrong, "Pixel"); !errors.Is(err, ErrPairingCode) {
			t.Fatalf("wrong code: %v", err)
		}
		var tries int
		_ = db.QueryRow(ctx, `SELECT wrong_tries FROM pairings WHERE id = $1`, p.ID).Scan(&tries)
		if tries != 1 {
			t.Errorf("wrong tries = %d, want 1 (counted, not rolled back)", tries)
		}
		j, err := e.svc.JoinPairing(ctx, u, code[:3]+" "+code[3:], "Pixel 6a")
		if err != nil || j.Status != PairingLinked || j.PhoneName != "Pixel 6a" {
			t.Fatalf("join = %+v, %v", j, err)
		}
		if _, err := e.svc.JoinPairing(ctx, u, code, "Again"); !errors.Is(err, ErrPairingCode) {
			t.Errorf("a code works once: %v", err)
		}

		st, err := e.svc.StartVia(ctx, u, e.lead(u.ID, list, "+12125550802", "Bo"), true)
		if err != nil || !st.ViaPhone {
			t.Fatalf("start via phone = %+v, %v", st, err)
		}
		phone, err := e.svc.PairingState(ctx, u.ID, true)
		if err != nil || phone.Call == nil || phone.Call.ID != st.CallID || !phone.Call.NeedsDial || phone.Call.ClientState != st.ClientState || phone.Call.LeadName != "Bo" {
			t.Fatalf("phone sees %+v, %v", phone.Call, err)
		}
		var device string
		_ = db.QueryRow(ctx, `SELECT device::text FROM calls WHERE id = $1`, st.CallID).Scan(&device)
		if device != "linked" {
			t.Errorf("device = %s", device)
		}
		// The phone dials: the provider's events move the call on as usual.
		e.event(st, telephony.EventInitiated, morning, "")
		if p, _ := e.svc.PairingState(ctx, u.ID, true); p.Call == nil || p.Call.NeedsDial {
			t.Errorf("after dialling the phone still needs to dial: %+v", p.Call)
		}
		if err := e.svc.SetPairingMuted(ctx, u.ID, true); err != nil {
			t.Fatal(err)
		}
		if p, _ := e.svc.PairingState(ctx, u.ID, false); !p.Muted {
			t.Error("mute not kept")
		}
		if _, err := e.svc.Hangup(ctx, u.ID, st.CallID); err != nil {
			t.Fatal(err)
		}
		if p, _ := e.svc.PairingState(ctx, u.ID, true); p.Call != nil {
			t.Errorf("ended call still on the phone: %+v", p.Call)
		}
	})

	t.Run("the phone drops: shown as lost, its call is ended", func(t *testing.T) {
		st, err := e.svc.StartVia(ctx, u, e.lead(u.ID, list, "+12125550803", "Cy"), true)
		if err != nil {
			t.Fatal(err)
		}
		e.event(st, telephony.EventInitiated, morning, "")
		e.event(st, telephony.EventAnswered, morning, "")
		e.clock = morning.Add(10 * time.Second)
		if p, _ := e.svc.PairingState(ctx, u.ID, false); p.Status != PairingLost || p.Call == nil {
			t.Fatalf("10 s quiet: %+v", p)
		}
		if _, err := e.svc.StartVia(ctx, u, e.lead(u.ID, list, "+12125550804", "Di"), true); err == nil {
			t.Error("a new call went to a lost phone")
		}
		e.clock = morning.Add(16 * time.Second)
		res, err := e.svc.Tick(ctx)
		e.clock = morning
		if err != nil {
			t.Fatal(err)
		}
		c := e.call(st.CallID)
		if c.Status != "ended" || c.HangupCause != "phone_lost" || c.Seconds != 16 || res.Ended < 1 {
			t.Fatalf("after 16 s: %+v (tick %+v)", c, res)
		}
	})

	t.Run("a new code replaces the link; unlinking ends it", func(t *testing.T) {
		p2, code2, err := e.svc.CreatePairing(ctx, u)
		if err != nil || p2.ID == p.ID {
			t.Fatalf("second code = %+v, %v", p2, err)
		}
		if _, err := e.svc.JoinPairing(ctx, u, code2, "iPhone"); err != nil {
			t.Fatal(err)
		}
		if err := e.svc.EndPairing(ctx, u.ID); err != nil {
			t.Fatal(err)
		}
		if p, _ := e.svc.PairingState(ctx, u.ID, false); p.Status != PairingNone {
			t.Errorf("after unlink: %+v", p)
		}
	})

	t.Run("five wrong codes end the pairing", func(t *testing.T) {
		_, good, err := e.svc.CreatePairing(ctx, u)
		if err != nil {
			t.Fatal(err)
		}
		bad := "123456"
		if good == bad {
			bad = "654321"
		}
		for range PairingWrongTries {
			_, _ = e.svc.JoinPairing(ctx, u, bad, "Guesser")
		}
		if _, err := e.svc.JoinPairing(ctx, u, good, "Me"); !errors.Is(err, ErrPairingCode) {
			t.Errorf("the right code after 5 wrong ones: %v", err)
		}
	})
}
