package plugin

import (
	"encoding/json"
	"fmt"
	"strings"
)

// OpenAIToolCall models an OpenAI-compatible tool call object.
type OpenAIToolCall struct {
	Index    int                `json:"index"`
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function OpenAIFunctionCall `json:"function"`
}

// OpenAIFunctionCall models the function name and JSON arguments string.
type OpenAIFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// SyntheticToolParser handles streaming text chunks from Gemini Argon and extracts tool calls.
type SyntheticToolParser struct {
	buffer      strings.Builder
	inToolFence bool
	callCount   int
}

// NewSyntheticToolParser creates a new SyntheticToolParser.
func NewSyntheticToolParser() *SyntheticToolParser {
	return &SyntheticToolParser{}
}

// extractBalancedJSON finds the first complete { ... } substring with balanced braces.
func extractBalancedJSON(s string) (string, int, int, bool) {
	start := strings.Index(s, "{")
	if start == -1 {
		return "", -1, -1, false
	}

	depth := 0
	inString := false
	isEscaped := false

	for i := start; i < len(s); i++ {
		c := s[i]
		if isEscaped {
			isEscaped = false
			continue
		}
		if c == '\\' {
			isEscaped = true
			continue
		}
		if c == '"' {
			inString = !inString
			continue
		}
		if inString {
			continue
		}

		if c == '{' {
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 {
				return s[start : i+1], start, i + 1, true
			}
		}
	}
	return "", -1, -1, false
}

// ParseSyntheticToolCalls extracts OpenAI tool calls from complete or partial Argon response text.
func ParseSyntheticToolCalls(text string) ([]OpenAIToolCall, string, bool) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil, text, false
	}

	var calls []OpenAIToolCall
	cleanText := trimmed

	// 1. Scan code fences: ``` ... ```
	cursor := 0
	for {
		if cursor >= len(cleanText) {
			break
		}
		startRel := strings.Index(cleanText[cursor:], "```")
		if startRel == -1 {
			break
		}
		start := cursor + startRel
		rest := cleanText[start+3:]
		closeRel := strings.Index(rest, "```")
		if closeRel == -1 {
			break
		}
		end := start + 3 + closeRel + 3
		fenceContent := rest[:closeRel]

		if jsonStr, _, _, ok := extractBalancedJSON(fenceContent); ok {
			if tc, valid := extractToolFromJSON(jsonStr, len(calls)); valid {
				calls = append(calls, tc)
				cleanText = cleanText[:start] + cleanText[end:]
				// cursor stays at start
				continue
			}
		}
		// If not a tool call fence, advance cursor past this code block
		cursor = end
	}

	// 2. Scan inline tool calls: tool_call { ... }
	cursor = 0
	for {
		if cursor >= len(cleanText) {
			break
		}
		tcRel := strings.Index(cleanText[cursor:], "tool_call")
		if tcRel == -1 {
			break
		}
		tcStart := cursor + tcRel
		after := cleanText[tcStart+len("tool_call"):]
		if jsonStr, _, endRel, ok := extractBalancedJSON(after); ok {
			if tc, valid := extractToolFromJSON(jsonStr, len(calls)); valid {
				calls = append(calls, tc)
				inlineEnd := tcStart + len("tool_call") + endRel
				cleanText = cleanText[:tcStart] + cleanText[inlineEnd:]
				continue
			}
		}
		cursor = tcStart + len("tool_call")
	}

	cleanText = strings.TrimSpace(cleanText)
	return calls, cleanText, len(calls) > 0
}

func extractToolFromJSON(rawJSON string, index int) (OpenAIToolCall, bool) {
	var parsed map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &parsed); err != nil {
		return OpenAIToolCall{}, false
	}

	// Case A: {"name": "func_name", "arguments": {...}}
	name, hasName := parsed["name"].(string)
	if hasName && strings.TrimSpace(name) != "" {
		argsStr := ""
		if rawArgs, ok := parsed["arguments"]; ok {
			switch v := rawArgs.(type) {
			case string:
				argsStr = v
			case map[string]any:
				if b, err := json.Marshal(v); err == nil {
					argsStr = string(b)
				}
			default:
				if b, err := json.Marshal(v); err == nil {
					argsStr = string(b)
				}
			}
		}
		return OpenAIToolCall{
			Index: index,
			ID:    fmt.Sprintf("call_argon_%d_%s", index, name),
			Type:  "function",
			Function: OpenAIFunctionCall{
				Name:      strings.TrimSpace(name),
				Arguments: argsStr,
			},
		}, true
	}

	// Case B: {"tool_call": {"name": "...", "arguments": ...}}
	if inner, ok := parsed["tool_call"].(map[string]any); ok {
		innerName, _ := inner["name"].(string)
		if innerName != "" {
			argsStr := "{}"
			if rawArgs, ok := inner["arguments"]; ok {
				if b, err := json.Marshal(rawArgs); err == nil {
					argsStr = string(b)
				}
			}
			return OpenAIToolCall{
				Index: index,
				ID:    fmt.Sprintf("call_argon_%d_%s", index, innerName),
				Type:  "function",
				Function: OpenAIFunctionCall{
					Name:      innerName,
					Arguments: argsStr,
				},
			}, true
		}
	}

	return OpenAIToolCall{}, false
}

// FormatOpenAIToolCallDelta generates an OpenAI SSE delta chunk for a tool call.
func FormatOpenAIToolCallDelta(call OpenAIToolCall, completionID string) string {
	if completionID == "" {
		completionID = "chatcmpl-argon-" + call.ID
	}

	chunk := map[string]any{
		"id":      completionID,
		"object":  "chat.completion.chunk",
		"created": 1700000000,
		"choices": []map[string]any{
			{
				"index": 0,
				"delta": map[string]any{
					"tool_calls": []OpenAIToolCall{call},
				},
				"finish_reason": nil,
			},
		},
	}

	b, _ := json.Marshal(chunk)
	return fmt.Sprintf("data: %s\n\n", string(b))
}

// FormatOpenAIFinishToolCallsChunk generates the final SSE chunk closing tool_calls.
func FormatOpenAIFinishToolCallsChunk(completionID string) string {
	if completionID == "" {
		completionID = "chatcmpl-argon-finish"
	}

	chunk := map[string]any{
		"id":      completionID,
		"object":  "chat.completion.chunk",
		"created": 1700000000,
		"choices": []map[string]any{
			{
				"index":         0,
				"delta":         map[string]any{},
				"finish_reason": "tool_calls",
			},
		},
	}

	b, _ := json.Marshal(chunk)
	return fmt.Sprintf("data: %s\n\ndata: [DONE]\n\n", string(b))
}
