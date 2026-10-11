package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/xdadwal/gte-vi/internal/platform"
	"golang.org/x/term"
)

func credentials(ctx context.Context, store *platform.Store, args []string) error {
	if args[0] != "set-password" {
		return errors.New("usage: gte set-password --email EMAIL [--password-stdin]")
	}
	flags := flag.NewFlagSet("set-password", flag.ContinueOnError)
	email := flags.String("email", "", "email of an existing enabled team member")
	stdin := flags.Bool("password-stdin", false, "read one password from stdin instead of prompting")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if *email == "" || flags.NArg() != 0 {
		return errors.New("--email is required; passwords must never be passed as arguments")
	}
	var password []byte
	var err error
	if *stdin {
		password, err = io.ReadAll(io.LimitReader(os.Stdin, 75))
		if len(password) > 74 {
			return errors.New("password exceeds 72 bytes")
		}
		password = []byte(strings.TrimSuffix(strings.TrimSuffix(string(password), "\n"), "\r"))
	} else {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return errors.New("interactive terminal required; use --password-stdin for a private pipe")
		}
		fmt.Fprint(os.Stderr, "New password (12+ characters; hidden): ")
		password, err = term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err == nil {
			fmt.Fprint(os.Stderr, "Confirm password: ")
			var confirmation []byte
			confirmation, err = term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Fprintln(os.Stderr)
			if err == nil && string(password) != string(confirmation) {
				return errors.New("passwords do not match")
			}
		}
	}
	if err != nil {
		return err
	}
	if err = store.SetAdminPassword(ctx, strings.ToLower(strings.TrimSpace(*email)), string(password)); err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "Password updated; existing sessions revoked.")
	return nil
}
