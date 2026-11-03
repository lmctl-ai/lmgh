// Offline process boundary for the protocol acceptance suite. No network calls.
package main

import (
	"fmt"
	"os"
	"strings"
)

func main() {
	f, err := os.OpenFile(os.Getenv("LMGH_CALLS"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		panic(err)
	}
	fmt.Fprintln(f, strings.Join(os.Args[1:], " "))
	if err := f.Close(); err != nil {
		panic(err)
	}
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println("gh version 2.103.3")
		return
	}
	if len(os.Args) > 2 && os.Args[1] == "issue" && os.Args[2] == "view" {
		fmt.Println(`{"number":42,"title":"test","state":"OPEN","author":{"login":"bot"},"url":"https://github.com/octo/demo/issues/42"}`)
	} else {
		fmt.Println("https://github.com/octo/demo/issues/42")
	}
}
