package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"strings"
	"testing"
)

func TestValidateAdminToken(t *testing.T) {
	// 1. Demasiado corto
	if err := validateAdminToken("short-token"); err == nil {
		t.Error("expected error for token with < 24 chars, got nil")
	}

	// 2. Patrones inseguros por defecto
	if err := validateAdminToken("admin-token-super-insecure-example-1234"); err == nil {
		t.Error("expected error for insecure keyword 'admin', got nil")
	}

	// 3. Token válido de alta entropía
	validToken := "a4f89d31e9c2b4e8f17a93c04218de9b3781fa0e1596"
	if err := validateAdminToken(validToken); err != nil {
		t.Errorf("unexpected error for valid token: %v", err)
	}
}

func TestEvaluateSeedRing(t *testing.T) {
	// Generar semilla determinista y evaluar clave pública
	pubV2Bytes, _ := hex.DecodeString(MasterPublicKeyHexV2)
	_ = pubV2Bytes

	// Probar con clave aleatoria
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("failed to generate ed25519 key: %v", err)
	}

	pubHex, classification := evaluateSeedRing(priv)
	if pubHex != hex.EncodeToString(pub) {
		t.Errorf("expected pubHex %s, got %s", hex.EncodeToString(pub), pubHex)
	}
	if !strings.Contains(classification, "Custom / Standalone") {
		t.Errorf("expected Custom classification, got %s", classification)
	}
}
