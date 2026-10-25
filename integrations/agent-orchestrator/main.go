// Restricted bridge into Agent Orchestrator's native Codex and worktree adapters.
// It exposes one owned conversation and one authorized turn, never a daemon API,
// account switching, credit reset, terminal, arbitrary provider or AO automation.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/aoagents/agent-orchestrator/backend/internal/adapters/chatdriver/codexappserver"
	"github.com/aoagents/agent-orchestrator/backend/internal/adapters/workspace/gitworktree"
	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/ports"
)

const revision = "1550d440b82ac9cfb3e671b060709457cdffbaea"

type request struct {
	Action      string `json:"action"`
	Binary      string `json:"binary"`
	Project     string `json:"project"`
	StateDir    string `json:"stateDir"`
	SessionID   string `json:"sessionId"`
	ThreadID    string `json:"threadId"`
	Model       string `json:"model"`
	Effort      string `json:"effort"`
	AllowWrites bool   `json:"allowWrites"`
	TimeoutMs   int    `json:"timeoutMs"`
	Prompt      string `json:"prompt"`
	BaseRef     string `json:"baseRef"`
}

func emit(value any) { _ = json.NewEncoder(os.Stdout).Encode(value) }
func read(r *bufio.Reader) (request, error) {
	var q request
	line, err := r.ReadString('\n')
	if err != nil {
		return q, err
	}
	if len(line) > 100000 {
		return q, errors.New("request too large")
	}
	if err = json.Unmarshal([]byte(line), &q); err != nil {
		return q, err
	}
	return q, nil
}
func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		emit(map[string]any{"protocol": 1, "engine": "agent-orchestrator", "revision": revision})
		return
	}
	r := bufio.NewReader(io.LimitReader(os.Stdin, 200000))
	q, err := read(r)
	if err == nil {
		err = run(r, q)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		emit(map[string]any{"kind": "error", "code": "ao_runtime_failed"})
		os.Exit(1)
	}
}
func run(r *bufio.Reader, q request) error {
	if !filepath.IsAbs(q.Project) || !filepath.IsAbs(q.StateDir) || q.SessionID == "" {
		return errors.New("invalid ownership")
	}
	if q.Action == "workspace" {
		w, err := gitworktree.New(gitworktree.Options{ManagedRoot: q.StateDir, RepoResolver: gitworktree.StaticRepoResolver{"office": q.Project}})
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		info, err := w.Create(ctx, ports.WorkspaceConfig{ProjectID: "office", SessionID: domain.SessionID(q.SessionID), Kind: domain.KindWorker, RepoPath: q.Project, Branch: "office/" + q.SessionID, BaseRef: q.BaseRef})
		if err != nil {
			return err
		}
		emit(map[string]any{"kind": "workspace", "path": info.Path, "branch": info.Branch, "baseSHA": info.BaseSHA})
		return nil
	}
	if q.Action != "open" || !filepath.IsAbs(q.Binary) || q.Model == "" || q.Effort == "" || q.TimeoutMs < 0 || q.TimeoutMs > 900000 {
		return errors.New("invalid launch")
	}
	ctx, cancel := context.WithCancel(context.Background())
	if q.TimeoutMs > 0 {
		cancel()
		ctx, cancel = context.WithTimeout(context.Background(), time.Duration(q.TimeoutMs)*time.Millisecond)
	}
	defer cancel()
	d := codexappserver.NewPixelOffice(q.Binary)
	var c ports.ChatConversation
	var err error
	if q.ThreadID == "" {
		c, err = d.Start(ctx, ports.ChatStartConfig{SessionID: domain.SessionID(q.SessionID), WorkspacePath: q.Project, DataDir: q.StateDir, Model: q.Model, Effort: q.Effort, ReadOnly: !q.AllowWrites, DisableNetwork: true, Permissions: ports.PermissionModeAcceptEdits})
	} else {
		c, err = d.Resume(ctx, ports.ChatResumeConfig{SessionID: domain.SessionID(q.SessionID), ProviderConversationID: q.ThreadID, WorkspacePath: q.Project, DataDir: q.StateDir, Model: q.Model, Effort: q.Effort, ReadOnly: !q.AllowWrites, Permissions: ports.PermissionModeAcceptEdits, HasPriorTurns: true})
	}
	if err != nil {
		return err
	}
	defer c.Close()
	emit(map[string]any{"kind": "ready", "threadId": c.ProviderConversationID()})
	// Parent verifies subscription again after connection and before this single turn.
	turn, err := read(r)
	if err != nil {
		return err
	}
	if turn.Action != "turn" || turn.Prompt == "" {
		return errors.New("turn unauthorized")
	}
	_, err = c.SendTurn(ctx, ports.ChatUserMessage{Text: turn.Prompt, ClientMessageID: q.SessionID + "-" + fmt.Sprint(time.Now().UnixNano()), Settings: ports.ChatTurnSettings{Model: q.Model, Effort: q.Effort, Approval: ports.PermissionModeAcceptEdits}})
	if err != nil {
		return err
	}
	// Some supported Codex builds send only a completed message; others also
	// stream deltas. Settle each item once, using deltas only as a fallback.
	texts := map[string]string{}
	settled := map[string]bool{}
	order := []string{}
	settle := func(id, text string) {
		if settled[id] {
			return
		}
		if text == "" {
			text = texts[id]
		}
		if text != "" {
			emit(map[string]any{"kind": "text", "text": text})
		}
		settled[id] = true
	}
	for {
		select {
		case <-ctx.Done():
			_ = c.Interrupt(context.Background(), "")
			return ctx.Err()
		case e, ok := <-c.Events():
			if !ok {
				return errors.New("event stream ended")
			}
			// Nested provider work cannot be accounted against a separately authorized run.
			if e.ProviderConversationID != "" && e.ProviderConversationID != c.ProviderConversationID() {
				_ = c.Interrupt(ctx, "")
				return errors.New("nested thread forbidden")
			}
			switch e.Kind {
			case ports.ChatEventMessageDelta:
				if _, ok := texts[e.ProviderItemID]; !ok {
					order = append(order, e.ProviderItemID)
				}
				texts[e.ProviderItemID] += e.Delta
			case ports.ChatEventMessageCompleted:
				settle(e.ProviderItemID, e.Text)
			case ports.ChatEventActivityStarted:
				emit(map[string]any{"kind": "activity", "activity": string(e.ActivityKind)})
			case ports.ChatEventUsage:
				if e.Usage != nil && e.Usage.TotalsKnown {
					emit(map[string]any{"kind": "usage", "input": e.Usage.InputTokens, "output": e.Usage.OutputTokens, "cached": e.Usage.CachedTokens})
				}
			case ports.ChatEventApprovalRequested, ports.ChatEventInputRequested:
				_ = c.Interrupt(ctx, "")
				return errors.New("human interaction required")
			case ports.ChatEventAccountChanged:
				if e.Account != nil && (e.Account.AuthMode != "chatgpt" || e.Account.ReauthRequired) {
					_ = c.Interrupt(ctx, "")
					return errors.New("account changed")
				}
			case ports.ChatEventModelRerouted:
				_ = c.Interrupt(ctx, "")
				return errors.New("model rerouted")
			case ports.ChatEventTurnCompleted:
				for _, id := range order {
					settle(id, "")
				}
				emit(map[string]any{"kind": "finished", "status": string(e.TurnState)})
				return nil
			}
		}
	}
}
