package main

import (
	_ "embed"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/lmctl-ai/lmcode-go"
)

//go:embed schema/lmgh.dsl.json
var schemaBytes []byte

const usage = "usage: lmgh --version | --lmcode-schema [--json] | --lmcode-signatures | [--lmcode|--first|--last] FILE ..."

func cliFailure() int {
	return lmcode.FailureFrame(os.Stdout, "cli", lmcode.NewError(lmcode.CLI_USAGE, usage))
}

func main() {
	os.Exit(run(os.Args[1:]))
}

type invocationArg struct {
	file     string
	priority int
	index    int
}

func run(args []string) int {
	if len(args) == 0 {
		return cliFailure()
	}
	switch args[0] {
	case "--version":
		if len(args) != 1 {
			return cliFailure()
		}
		fmt.Printf("lmgh %s\n", version)
		return 0
	case "--lmcode-schema":
		if len(args) > 2 || (len(args) == 2 && args[1] != "--json") {
			return cliFailure()
		}
		os.Stdout.Write(schemaBytes)
		return 0
	case "--lmcode-signatures":
		if len(args) != 1 {
			return cliFailure()
		}
		for _, sig := range NewHost().reg.Signatures() {
			fmt.Println(sig)
		}
		return 0
	}

	// Repeated [--lmcode|--first|--last] FILE pairs: first roles run before
	// normal roles and last roles after, stable within each role.
	var parts []invocationArg
	var files []string
	if len(args)%2 != 0 {
		return cliFailure()
	}
	for i := 0; i < len(args); i += 2 {
		priority := 1
		switch args[i] {
		case "--lmcode":
		case "--first":
			priority = 0
		case "--last":
			priority = 2
		default:
			return cliFailure()
		}
		parts = append(parts, invocationArg{file: args[i+1], priority: priority, index: len(parts)})
		files = append(files, args[i+1])
	}
	results, err := lmcode.InvocationResultsFromCommand(files)
	if err != nil {
		return lmcode.FailureFrame(os.Stdout, "cli", err)
	}
	contract, err := lmcode.ResultContractFromSchema(schemaBytes)
	if err != nil {
		return lmcode.FailureFrame(os.Stdout, "load", err)
	}

	host := NewHost()
	host.dryRun = results.Dry()
	ctx := lmcode.NewContext()
	ctx.SetDry(results.Dry())
	ctx.Set("gh", host)
	ctx.Set("report", host.report)

	sort.SliceStable(parts, func(i, j int) bool { return parts[i].priority < parts[j].priority })
	for _, part := range parts {
		idx := part.index
		bytecode, err := os.ReadFile(part.file)
		if err != nil {
			_ = results.Fail(&idx, "app", lmcode.NewError(lmcode.APP_FAIL, "cannot read bytecode file"))
			break
		}
		program, err := lmcode.Load(bytecode, schemaBytes, host.reg)
		if err != nil {
			_ = results.Fail(&idx, "load", normalizeLoadError(err))
			break
		}
		if _, err := results.Select(idx, host.reg, contract); err != nil {
			_ = results.Fail(&idx, "run", err)
			break
		}
		if err := program.Run(ctx, host.reg); err != nil {
			_ = results.Fail(&idx, "run", err)
			break
		}
		if err := results.Complete(idx); err != nil {
			_ = results.Fail(&idx, "run", err)
			break
		}
	}
	return results.WriteFrame(os.Stdout)
}

// normalizeLoadError maps SDK load failures onto the portable contract
// messages so loader output never leaks machine-specific paths.
func normalizeLoadError(err error) error {
	var e *lmcode.Error
	if !errors.As(err, &e) {
		return lmcode.NewError(lmcode.LOAD_BAD_BYTECODE, "bad bytecode")
	}
	switch e.Code {
	case lmcode.LOAD_BAD_BYTECODE:
		return lmcode.NewError(e.Code, "bad bytecode: not a valid lmgh program")
	case lmcode.LOAD_SCHEMA_MISMATCH:
		return lmcode.NewError(e.Code, "bytecode was compiled against a different schema")
	case lmcode.LOAD_UNBOUND:
		msg := e.Message
		if i := strings.Index(msg, " (declared:"); i >= 0 {
			msg = msg[:i]
		}
		return lmcode.NewError(e.Code, "host does not declare: "+msg)
	default:
		return e
	}
}
