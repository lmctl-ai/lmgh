// CLI process fixture forwarding argv to the test's loopback audit server.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println("gh version 2.103.3")
		return
	}
	body, err := json.Marshal(os.Args[1:])
	if err != nil {
		panic(err)
	}
	response, err := http.Post(os.Getenv("LMGH_MOCK_URL"), "application/json", bytes.NewReader(body))
	if err != nil {
		panic(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		os.Exit(1)
	}
	if _, err = io.Copy(os.Stdout, response.Body); err != nil {
		panic(err)
	}
}
