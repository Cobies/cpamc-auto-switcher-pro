package license

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"
)

func TestLicenseVerificationAndMachineLock(t *testing.T) {
	// Recreate private key matching MasterPublicKeyHex
	privHex := "3144b5a27ebff1ca566dd9c31afb5e8761d3590cb0b106caab0ccbca2fafae91"
	seedBytes, _ := hex.DecodeString(privHex)
	privKey := ed25519.NewKeyFromSeed(seedBytes)

	validMachineID := "CPA-AAAA-BBBB-CCCC"
	foreignMachineID := "CPA-XXXX-YYYY-ZZZZ"

	signPayload := func(claims LicenseClaims) string {
		data, _ := json.Marshal(claims)
		sig := ed25519.Sign(privKey, data)
		return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(sig)
	}

	t.Run("Valid active Pro license matches machine", func(t *testing.T) {
		claims := LicenseClaims{
			MachineID: validMachineID,
			Client:    "Wilox",
			Tier:      "pro",
			IssuedAt:  time.Now().Unix(),
			ExpiresAt: time.Now().Add(365 * 24 * time.Hour).Unix(),
		}
		key := signPayload(claims)

		verified, err := VerifyActivationKey(key, validMachineID)
		if err != nil {
			t.Fatalf("expected key to verify, got: %v", err)
		}
		if verified.Tier != "pro" {
			t.Errorf("expected tier pro, got %s", verified.Tier)
		}
	})

	t.Run("Machine mismatch strictly fails", func(t *testing.T) {
		claims := LicenseClaims{
			MachineID: validMachineID,
			Client:    "Wilox",
			Tier:      "pro",
			IssuedAt:  time.Now().Unix(),
			ExpiresAt: time.Now().Add(365 * 24 * time.Hour).Unix(),
		}
		key := signPayload(claims)

		_, err := VerifyActivationKey(key, foreignMachineID)
		if err == nil {
			t.Fatalf("expected error on foreign machine, got nil")
		}
	})

	t.Run("Expired license fails", func(t *testing.T) {
		claims := LicenseClaims{
			MachineID: validMachineID,
			Client:    "Wilox",
			Tier:      "pro",
			IssuedAt:  time.Now().Add(-48 * time.Hour).Unix(),
			ExpiresAt: time.Now().Add(-24 * time.Hour).Unix(),
		}
		key := signPayload(claims)

		_, err := VerifyActivationKey(key, validMachineID)
		if err == nil {
			t.Fatalf("expected error on expired license, got nil")
		}
	})

	t.Run("Tampered payload fails signature", func(t *testing.T) {
		claims := LicenseClaims{
			MachineID: validMachineID,
			Client:    "Wilox",
			Tier:      "pro",
			IssuedAt:  time.Now().Unix(),
			ExpiresAt: time.Now().Add(365 * 24 * time.Hour).Unix(),
		}
		key := signPayload(claims)
		parts := []rune(key)
		// Alter one character
		if parts[5] == 'A' {
			parts[5] = 'B'
		} else {
			parts[5] = 'A'
		}
		tampered := string(parts)

		_, err := VerifyActivationKey(tampered, validMachineID)
		if err == nil {
			t.Fatalf("expected error on tampered key, got nil")
		}
	})
}
