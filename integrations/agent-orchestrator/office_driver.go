// Pixel Office integration, added to the pinned Apache-2.0 AO source at build time.
// No change to upstream defaults: this constructor is used only by our bridge.
package codexappserver

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"time"

	aoprocess "github.com/aoagents/agent-orchestrator/backend/internal/process"
)

// NewPixelOffice reuses AO's native protocol, resume, usage and interruption.
// Providers are tied to the owned bridge process; an office restart cannot leave
// a detached controller continuing a turn without the office budget controller.
func NewPixelOffice(binary string) *Driver {
	d := New(fixedCodexPlugin(binary), slog.New(slog.DiscardHandler))
	d.persistent = false
	d.spawn = pixelOfficeSpawn
	return d
}

func pixelOfficeArgs() []string {
	args := []string{"app-server", "--stdio"}
	for _, value := range []string{
		`model_provider="openai"`, `forced_login_method="chatgpt"`,
		`model_providers={}`, `mcp_servers={}`, `apps={}`, `hooks={}`,
		`features.plugins=false`, `features.apps=false`, `features.multi_agent=false`,
		`features.multi_agent_v2={enabled=false}`, `features.image_generation=false`,
		`web_search="disabled"`, `analytics.enabled=false`,
		`shell_environment_policy.inherit="core"`,
		`shell_environment_policy.ignore_default_excludes=false`,
	} {
		args = append(args, "-c", value)
	}
	return args
}

// Pipe lifecycle adapted from AO spawnAppServer at the locked revision.
func pixelOfficeSpawn(ctx context.Context, bin, workdir string, env []string) (*process, error) {
	cmd := aoprocess.CommandContext(ctx, bin, pixelOfficeArgs()...)
	cmd.Dir, cmd.Env = workdir, env
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		return nil, fmt.Errorf("official app-server: %w", err)
	}
	go func() { _, _ = io.Copy(io.Discard, stderr) }()
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	return &process{stdin: stdin, stdout: stdout, stop: func() error {
		_ = stdin.Close()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			_ = cmd.Process.Kill()
			<-done
		}
		return nil
	}}, nil
}
