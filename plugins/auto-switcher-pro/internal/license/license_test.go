package license

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

// TestLicenseVerificationAndMachineLock usa un par de claves Ed25519 EFÍMERO generado en runtime.
// NUNCA se hardcodean semillas privadas en el código: los secretos viven exclusivamente
// en el entorno de producción (.env en el VPS), jamás en el repositorio.
func TestLicenseVerificationAndMachineLock(t *testing.T) {
	// Generar par de claves efímero para la prueba (cero secretos en Git)
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate ephemeral key pair: %v", err)
	}

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

		verified, err := verifyActivationKeyWithPub(key, validMachineID, pubKey)
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

		_, err := verifyActivationKeyWithPub(key, foreignMachineID, pubKey)
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

		_, err := verifyActivationKeyWithPub(key, validMachineID, pubKey)
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

		_, err := verifyActivationKeyWithPub(tampered, validMachineID, pubKey)
		if err == nil {
			t.Fatalf("expected error on tampered key, got nil")
		}
	})
}
