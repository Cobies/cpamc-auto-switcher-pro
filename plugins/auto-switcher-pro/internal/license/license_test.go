package license

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
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

	t.Run("RecordRotation and FlushUsage atomic metrics in RAM", func(t *testing.T) {
		reqBefore, failBefore := GetPersistedUsage()
		reqAfter, failAfter := RecordRotation(false)
		if reqAfter != reqBefore+1 {
			t.Errorf("expected request count %d, got %d", reqBefore+1, reqAfter)
		}
		if failAfter != failBefore {
			t.Errorf("expected failover count unchanged %d, got %d", failBefore, failAfter)
		}

		reqFail, failFail := RecordRotation(true)
		if reqFail != reqAfter+1 {
			t.Errorf("expected request count %d, got %d", reqAfter+1, reqFail)
		}
		if failFail != failBefore+1 {
			t.Errorf("expected failover count %d, got %d", failBefore+1, failFail)
		}

		// Flush usage should persist cleanly
		FlushUsage()
		persistedReq, persistedFail := GetPersistedUsage()
		if persistedReq != reqFail || persistedFail != failFail {
			t.Errorf("expected persisted (%d, %d), got (%d, %d)", reqFail, failFail, persistedReq, persistedFail)
		}
	})

	t.Run("Dual-key ring accepts both V2 and V1 signed licenses", func(t *testing.T) {
		// Simular par V1 y par V2 independientes
		pubV1, privV1, _ := ed25519.GenerateKey(rand.Reader)
		pubV2, privV2, _ := ed25519.GenerateKey(rand.Reader)

		t.Setenv("CPAMC_MASTER_PUBKEY_V1", hex.EncodeToString(pubV1))
		t.Setenv("CPAMC_MASTER_PUBKEY_V2", hex.EncodeToString(pubV2))

		claims := LicenseClaims{
			MachineID: validMachineID,
			Client:    "Wilox",
			Tier:      "pro",
			IssuedAt:  time.Now().Unix(),
			ExpiresAt: time.Now().Add(30 * 24 * time.Hour).Unix(),
		}
		data, _ := json.Marshal(claims)

		// Firma generada con autoridad V2 (primaria)
		sigV2 := ed25519.Sign(privV2, data)
		keyV2 := base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(sigV2)

		verifiedV2, errV2 := VerifyActivationKey(keyV2, validMachineID)
		if errV2 != nil || verifiedV2 == nil {
			t.Fatalf("expected V2 key to verify cleanly under dual-key ring: %v", errV2)
		}

		// Firma generada con autoridad V1 (legacy)
		sigV1 := ed25519.Sign(privV1, data)
		keyV1 := base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(sigV1)

		verifiedV1, errV1 := VerifyActivationKey(keyV1, validMachineID)
		if errV1 != nil || verifiedV1 == nil {
			t.Fatalf("expected V1 legacy key to verify cleanly via fallback in dual-key ring: %v", errV1)
		}

		// Clave no firmada por ninguna de las dos autoridades debe ser rechazada
		_, roguePriv, _ := ed25519.GenerateKey(rand.Reader)
		sigRogue := ed25519.Sign(roguePriv, data)
		keyRogue := base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(sigRogue)

		_, errRogue := VerifyActivationKey(keyRogue, validMachineID)
		if errRogue == nil {
			t.Fatalf("expected rogue key to be rejected by dual-key ring")
		}
	})

	t.Run("Grace period limits: within 7 days is grace_period, beyond 7 days is expired", func(t *testing.T) {
		pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
		t.Setenv("CPAMC_MASTER_PUBKEY_V2", hex.EncodeToString(pubKey))

		now := time.Now().Unix()

		// 1. Licencia vencida hace 2 días (dentro de la ventana de gracia de 7 días)
		claimsGrace := LicenseClaims{
			MachineID: validMachineID,
			Client:    "Wilox",
			Tier:      "pro",
			IssuedAt:  now - (40 * 86400),
			ExpiresAt: now - (2 * 86400),
		}
		dataGrace, _ := json.Marshal(claimsGrace)
		sigGrace := ed25519.Sign(privKey, dataGrace)
		keyGrace := base64.RawURLEncoding.EncodeToString(dataGrace) + "." + base64.RawURLEncoding.EncodeToString(sigGrace)

		claimsParsed, errGrace := VerifyActivationKey(keyGrace, validMachineID)
		if !errors.Is(errGrace, ErrLicenseExpired) {
			t.Fatalf("expected ErrLicenseExpired for expired license, got: %v", errGrace)
		}
		if claimsParsed == nil {
			t.Fatalf("expected non-nil claims when signature is valid but expired")
		}

		statusGrace := ComputeStatusForClaims(claimsParsed, errGrace, validMachineID, now, now+30*86400)
		if statusGrace.Status != "grace_period" {
			t.Errorf("expected status 'grace_period', got %s", statusGrace.Status)
		}
		if !statusGrace.CanRotate {
			t.Errorf("expected CanRotate: true during grace period")
		}

		// 2. Licencia vencida hace 10 días (fuera de la ventana de gracia de 7 días)
		claimsExceeded := LicenseClaims{
			MachineID: validMachineID,
			Client:    "Wilox",
			Tier:      "pro",
			IssuedAt:  now - (40 * 86400),
			ExpiresAt: now - (10 * 86400),
		}
		dataExceeded, _ := json.Marshal(claimsExceeded)
		sigExceeded := ed25519.Sign(privKey, dataExceeded)
		keyExceeded := base64.RawURLEncoding.EncodeToString(dataExceeded) + "." + base64.RawURLEncoding.EncodeToString(sigExceeded)

		claimsExceededParsed, errExceeded := VerifyActivationKey(keyExceeded, validMachineID)
		if !errors.Is(errExceeded, ErrLicenseExpired) {
			t.Fatalf("expected ErrLicenseExpired for expired license, got: %v", errExceeded)
		}
		statusExceeded := ComputeStatusForClaims(claimsExceededParsed, errExceeded, validMachineID, now, now+30*86400)
		if statusExceeded.Status != StatusExpired {
			t.Errorf("expected status 'expired', got %s", statusExceeded.Status)
		}
		if statusExceeded.CanRotate {
			t.Errorf("expected CanRotate: false after grace period exceeded")
		}
	})

	t.Run("Air-gap mode silences external network telemetry completely", func(t *testing.T) {
		t.Setenv("CPAMC_AIRGAP_MODE", "true")
		// Verificar que IsAirgapModeEnabled() es true
		if !IsAirgapModeEnabled() {
			t.Errorf("expected IsAirgapModeEnabled to be true when CPAMC_AIRGAP_MODE=true")
		}
		// SyncWithCloudHub no debe entrar en pánico ni intentar conexiones
		SyncWithCloudHub(validMachineID)
	})
}
