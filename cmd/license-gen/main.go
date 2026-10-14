package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// Private seed known ONLY to Wilox for signing commercial licenses
const privateSeedHex = "3144b5a27ebff1ca566dd9c31afb5e8761d3590cb0b106caab0ccbca2fafae91"

type LicenseClaims struct {
	MachineID string `json:"machine_id"`
	Client    string `json:"client"`
	Tier      string `json:"tier"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

func main() {
	machineFlag := flag.String("machine", "", "Machine ID del cliente (ej: CPA-XXXX-XXXX-XXXX)")
	clientFlag := flag.String("client", "Cliente", "Nombre o identificador del comprador (ej: usuario@email.com o handle)")
	tierFlag := flag.String("tier", "pro", "Nivel de licencia: 'pro' o 'enterprise'")
	daysFlag := flag.Int("days", 365, "Días de validez (0 para licencia de por vida / lifetime)")
	methodFlag := flag.String("payment", "binance", "Método de pago registrado: 'binance', 'paypal', 'otro'")

	flag.Parse()

	if strings.TrimSpace(*machineFlag) == "" {
		fmt.Println("==================================================================")
		fmt.Println("⚡ AUTO-SWITCHER PRO · GENERADOR PRIVADO DE LICENCIAS (WILOX) ⚡")
		fmt.Println("==================================================================")
		fmt.Println("Uso:")
		fmt.Println("  go run ./cmd/license-gen --machine \"CPA-XXXX-XXXX-XXXX\" [opciones]")
		fmt.Println("")
		fmt.Println("Opciones:")
		fmt.Println("  --machine <id>     Machine ID único provisto por el cliente (REQUERIDO)")
		fmt.Println("  --client  <nombre> Nombre, correo o usuario del comprador (def: Cliente)")
		fmt.Println("  --tier    <pro>    Nivel de licencia ('pro' o 'enterprise')")
		fmt.Println("  --days    <365>    Días de validez (365 = 1 año, 0 = Lifetime)")
		fmt.Println("  --payment <medio>  Medio de pago (binance, paypal)")
		fmt.Println("")
		fmt.Println("Ejemplo:")
		fmt.Println("  go run ./cmd/license-gen --machine \"CPA-99B1-A7F2-4D02\" --client \"Amigo\" --days 365")
		os.Exit(1)
	}

	seed, err := hex.DecodeString(privateSeedHex)
	if err != nil || len(seed) != ed25519.SeedSize {
		fmt.Fprintf(os.Stderr, "Error en clave privada: %v\n", err)
		os.Exit(1)
	}
	privKey := ed25519.NewKeyFromSeed(seed)

	now := time.Now()
	var expTime int64
	var expLabel string
	if *daysFlag > 0 {
		exp := now.Add(time.Duration(*daysFlag) * 24 * time.Hour)
		expTime = exp.Unix()
		expLabel = fmt.Sprintf("%d días (hasta %s)", *daysFlag, exp.Format("2006-01-02"))
	} else {
		expTime = 0
		expLabel = "De por vida (Lifetime)"
	}

	claims := LicenseClaims{
		MachineID: strings.TrimSpace(*machineFlag),
		Client:    strings.TrimSpace(*clientFlag),
		Tier:      strings.ToLower(strings.TrimSpace(*tierFlag)),
		IssuedAt:  now.Unix(),
		ExpiresAt: expTime,
	}

	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error serializando claims: %v\n", err)
		os.Exit(1)
	}

	sig := ed25519.Sign(privKey, payloadBytes)

	token := base64.RawURLEncoding.EncodeToString(payloadBytes) + "." + base64.RawURLEncoding.EncodeToString(sig)

	fmt.Println("==================================================================")
	fmt.Println("🎉 LICENCIA COMERCIAL GENERADA CON ÉXITO")
	fmt.Println("==================================================================")
	fmt.Printf("Cliente:        %s\n", claims.Client)
	fmt.Printf("Machine ID:     %s (Bloqueada a esta máquina)\n", claims.MachineID)
	fmt.Printf("Nivel:          %s\n", strings.ToUpper(claims.Tier))
	fmt.Printf("Duración:       %s\n", expLabel)
	fmt.Printf("Pago:           %s\n", strings.ToUpper(*methodFlag))
	fmt.Println("------------------------------------------------------------------")
	fmt.Println("CLAVE DE ACTIVACIÓN (Entregar al cliente para pegar en su panel):")
	fmt.Println("")
	fmt.Printf("%s\n\n", token)
	fmt.Println("==================================================================")
}
