package plugin

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSSEProxy_ConcurrencyStressAndLeakPrevention(t *testing.T) {
	// 1. Configurar upstream SSE mock
	var upstreamRequests int64
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&upstreamRequests, 1)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Flushing not supported", http.StatusInternalServerError)
			return
		}

		notify := r.Context().Done()
		for i := 0; i < 5; i++ {
			select {
			case <-notify:
				// Cliente desconectado en upstream
				return
			default:
				_, _ = fmt.Fprintf(w, "data: {\"chunk\": %d, \"content\": \"stress test stream payload\"}\n\n", i)
				flusher.Flush()
				time.Sleep(10 * time.Millisecond)
			}
		}
	}))
	defer upstreamServer.Close()

	// 2. Instanciar proxy SSE con heartbeat ágil
	proxy := newSSEProxyHandler()
	parsedUpstream, _ := url.Parse(upstreamServer.URL)
	proxy.SetUpstreamBaseURL(parsedUpstream.String())
	proxy.config.HeartbeatInterval = 25 * time.Millisecond

	proxyServer := httptest.NewServer(proxy)
	defer proxyServer.Close()

	initialGoroutines := runtime.NumGoroutine()

	// 3. Lanzar 60 clientes concurrentes
	concurrency := 60
	var wg sync.WaitGroup
	var completedStreams int64
	var cancelledStreams int64

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		clientIdx := i
		go func() {
			defer wg.Done()

			// Alternar entre lectura completa y corte abrupto de conexión
			if clientIdx%2 == 0 {
				// Grupo A: Lectura completa
				req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, proxyServer.URL+"/auto-switcher-pro/sse-proxy/v1beta/models:streamGenerateContent", nil)
				if err != nil {
					t.Errorf("failed to create request: %v", err)
					return
				}
				resp, err := client.Do(req)
				if err != nil {
					t.Errorf("request failed: %v", err)
					return
				}
				defer resp.Body.Close()

				reader := bufio.NewReader(resp.Body)
				receivedChunks := 0
				for {
					line, err := reader.ReadString('\n')
					if strings.HasPrefix(line, "data:") {
						receivedChunks++
					}
					if err != nil {
						break
					}
				}
				if receivedChunks > 0 {
					atomic.AddInt64(&completedStreams, 1)
				}
			} else {
				// Grupo B: Cancelación abrupta a mitad de stream
				ctx, cancel := context.WithCancel(context.Background())
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, proxyServer.URL+"/auto-switcher-pro/sse-proxy/v1beta/models:streamGenerateContent", nil)
				if err != nil {
					cancel()
					return
				}
				resp, err := client.Do(req)
				if err != nil {
					cancel()
					return
				}
				defer resp.Body.Close()

				// Leer solo 1 chunk y cortar bruscamente el socket
				buf := make([]byte, 64)
				_, _ = resp.Body.Read(buf)
				cancel()
				_, _ = io.ReadAll(resp.Body) // Drenar para forzar transporte limpio
				atomic.AddInt64(&cancelledStreams, 1)
			}
		}()
	}

	wg.Wait()

	// 4. Verificación de resultados funcionales
	if atomic.LoadInt64(&completedStreams) == 0 {
		t.Errorf("expected completed streams, got 0")
	}
	if atomic.LoadInt64(&cancelledStreams) == 0 {
		t.Errorf("expected cancelled streams, got 0")
	}

	// 5. Cerrar conexiones idle para verificar que no queden goroutines de proxy colgadas
	client.CloseIdleConnections()
	if tr, ok := proxy.client.Transport.(*http.Transport); ok {
		tr.CloseIdleConnections()
	}
	proxyServer.CloseClientConnections()
	upstreamServer.CloseClientConnections()

	// Verificación de fugas de goroutines (Drain barrier)
	leaked := true
	for attempt := 0; attempt < 20; attempt++ {
		time.Sleep(25 * time.Millisecond)
		currentGoroutines := runtime.NumGoroutine()
		// Permitir una variación mínima propia de los pools HTTP internos de Go
		if currentGoroutines <= initialGoroutines+5 {
			leaked = false
			break
		}
	}

	if leaked {
		t.Errorf("potential goroutine leak: initial=%d, current=%d", initialGoroutines, runtime.NumGoroutine())
	}
}
