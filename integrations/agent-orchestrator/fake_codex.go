//go:build ignore

// Local protocol fixture. This executable has no model, network or credentials.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println("codex-cli 0.163.0")
		return
	}
	scan := bufio.NewScanner(os.Stdin)
	scan.Buffer(make([]byte, 4096), 2000000)
	enc := json.NewEncoder(os.Stdout)
	notify := func(method string, p any) { _ = enc.Encode(map[string]any{"method": method, "params": p}) }
	for scan.Scan() {
		var q struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params map[string]any  `json:"params"`
		}
		if json.Unmarshal(scan.Bytes(), &q) != nil {
			return
		}
		if len(q.ID) == 0 {
			continue
		}
		result := any(map[string]any{})
		if q.Method == "thread/start" || q.Method == "thread/resume" {
			result = map[string]any{"thread": map[string]any{"id": "fixture-thread"}, "model": "gpt-6.1-sol", "reasoningEffort": "low"}
		}
		if q.Method == "model/list" {
			result = map[string]any{"data": []any{}}
		}
		if q.Method == "turn/start" {
			result = map[string]any{"turn": map[string]any{"id": "fixture-turn", "status": "inProgress"}}
		}
		_ = enc.Encode(map[string]any{"id": q.ID, "result": result})
		if q.Method != "turn/start" {
			continue
		}
		text := fmt.Sprint(q.Params["input"])
		if strings.Contains(text, "FIXTURE_HANG") {
			for {
				time.Sleep(time.Hour)
			}
		}
		policy, _ := q.Params["sandboxPolicy"].(map[string]any)
		if strings.Contains(text, "FIXTURE_WRITE") && policy["type"] == "workspaceWrite" {
			_ = os.WriteFile("output.txt", []byte("isolated fixture output"), 0600)
		}
		file := filepath.Join(".", ".fixture-usage.json")
		n := 0
		if b, e := os.ReadFile(file); e == nil {
			_ = json.Unmarshal(b, &n)
		}
		n++
		b, _ := json.Marshal(n)
		_ = os.WriteFile(file, b, 0600)
		_ = os.WriteFile(".fixture-request.json", scan.Bytes(), 0600)
		answer := "Análisis completado; el código inicial tiene defectos.\nOFFICE_RESULT {\"status\":\"completed\"}"
		if !strings.Contains(text, "FIXTURE_COMPLETE_ONLY") {
			notify("item/agentMessage/delta", map[string]any{"threadId": "fixture-thread", "turnId": "fixture-turn", "itemId": "message", "delta": answer})
		}
		if !strings.Contains(text, "FIXTURE_DELTA_ONLY") {
			notify("item/completed", map[string]any{"threadId": "fixture-thread", "turnId": "fixture-turn", "item": map[string]any{"id": "message", "type": "agentMessage", "text": answer}})
		}
		if !strings.Contains(text, "FIXTURE_NO_USAGE") {
			notify("thread/tokenUsage/updated", map[string]any{"threadId": "fixture-thread", "tokenUsage": map[string]any{"total": map[string]any{"inputTokens": 100 * n, "outputTokens": 20 * n, "cachedInputTokens": 40 * n, "totalTokens": 120 * n}, "last": map[string]any{"totalTokens": 120}}})
		}
		notify("turn/completed", map[string]any{"threadId": "fixture-thread", "turn": map[string]any{"id": "fixture-turn", "status": "completed", "items": []any{}}})
	}
}
