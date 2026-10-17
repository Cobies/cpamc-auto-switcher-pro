package plugin

import (
	"strings"
	"testing"
)

func TestParseSyntheticToolCalls(t *testing.T) {
	// 1. Markdown code fence with tool_call
	sampleFenced := "Claro, consultaré el clima para ti:\n```tool_call\n{\n  \"name\": \"get_weather\",\n  \"arguments\": {\"city\": \"Madrid\", \"days\": 3}\n}\n```\nEspero que te sirva."
	calls, cleanText, hasTools := ParseSyntheticToolCalls(sampleFenced)
	if !hasTools {
		t.Fatalf("expected tools detected in fenced sample")
	}
	if len(calls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(calls))
	}
	if calls[0].Function.Name != "get_weather" {
		t.Errorf("got func name %q, want get_weather", calls[0].Function.Name)
	}
	if !strings.Contains(calls[0].Function.Arguments, "Madrid") {
		t.Errorf("expected arguments to contain Madrid, got %s", calls[0].Function.Arguments)
	}
	if strings.Contains(cleanText, "```tool_call") {
		t.Errorf("cleanText should not contain tool fence, got %s", cleanText)
	}

	// 2. Inline tool_call pattern
	sampleInline := "tool_call {\"name\": \"search_docs\", \"arguments\": {\"query\": \"CPAMC\"}}"
	calls2, _, hasTools2 := ParseSyntheticToolCalls(sampleInline)
	if !hasTools2 {
		t.Fatalf("expected tools in inline sample")
	}
	if calls2[0].Function.Name != "search_docs" {
		t.Errorf("got %s, want search_docs", calls2[0].Function.Name)
	}

	// 3. Regular response without tools
	samplePlain := "Esta es una respuesta normal en prosa sin ninguna llamada a función."
	calls3, _, hasTools3 := ParseSyntheticToolCalls(samplePlain)
	if hasTools3 || len(calls3) > 0 {
		t.Errorf("expected no tools in plain sample")
	}
}

func TestFormatOpenAIToolCallDelta(t *testing.T) {
	call := OpenAIToolCall{
		Index: 0,
		ID:    "call_test_123",
		Type:  "function",
		Function: OpenAIFunctionCall{
			Name:      "execute_bash",
			Arguments: "{\"cmd\": \"ls\"}",
		},
	}

	deltaSSE := FormatOpenAIToolCallDelta(call, "chatcmpl-test")
	if !strings.HasPrefix(deltaSSE, "data: {") {
		t.Errorf("expected SSE data: prefix, got %s", deltaSSE)
	}
	if !strings.Contains(deltaSSE, "execute_bash") {
		t.Errorf("expected delta to contain execute_bash, got %s", deltaSSE)
	}

	finishSSE := FormatOpenAIFinishToolCallsChunk("chatcmpl-test")
	if !strings.Contains(finishSSE, "tool_calls") || !strings.Contains(finishSSE, "[DONE]") {
		t.Errorf("expected finish chunk with tool_calls and [DONE], got %s", finishSSE)
	}
}
