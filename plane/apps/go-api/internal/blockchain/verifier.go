package blockchain

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type VerificationError struct {
	Message string
	Status  int
}

func (e VerificationError) Error() string { return e.Message }

func (e VerificationError) HTTPStatus() int { return e.Status }

type Config struct {
	RPCURL          string
	ContractAddress string
	ChainID         string
	RPCTimeout      time.Duration
	ReceiptWait     time.Duration
}

type RPC interface {
	Call(context.Context, string, []any) (any, error)
}

type HTTPRPC struct {
	URL    string
	Client *http.Client
}

func (c HTTPRPC) Call(ctx context.Context, method string, params []any) (any, error) {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	client := c.Client
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, res.Body)
		return nil, fmt.Errorf("rpc status %d", res.StatusCode)
	}
	var response struct {
		Result any            `json:"result"`
		Error  map[string]any `json:"error"`
	}
	if err = json.NewDecoder(res.Body).Decode(&response); err != nil {
		return nil, err
	}
	if response.Error != nil {
		return nil, fmt.Errorf("rpc rejected request")
	}
	return response.Result, nil
}

type Verifier struct {
	Config Config
	RPC    RPC
	Now    func() time.Time
}

func (v Verifier) PingContext(ctx context.Context) error {
	parsedURL, err := url.Parse(v.Config.RPCURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || v.Config.ContractAddress == "" || v.Config.ChainID == "" {
		return fmt.Errorf("verifier not fully configured")
	}

	rpc := v.RPC
	if rpc == nil {
		rpc = HTTPRPC{URL: v.Config.RPCURL, Client: &http.Client{Timeout: v.Config.RPCTimeout}}
	}

	result, err := rpc.Call(ctx, "eth_chainId", nil)

	if err != nil {
		return fmt.Errorf("rpc ping failed: %w", err)
	}

	// Optionally check if the chain ID matches the configured one
	chainIDHex, ok := result.(string)
	if !ok {
		return fmt.Errorf("rpc ping returned invalid chain ID format")
	}

	chainIDInt, err := strconv.ParseInt(strings.TrimPrefix(chainIDHex, "0x"), 16, 64)
	if err != nil {
		return fmt.Errorf("rpc ping returned invalid chain ID: %s", chainIDHex)
	}
	expectedChainIDInt, err := strconv.ParseInt(v.Config.ChainID, 10, 64)
	if err == nil && chainIDInt != expectedChainIDInt {
		return fmt.Errorf("rpc ping returned chain ID %d, expected %d", chainIDInt, expectedChainIDInt)
	}

	return nil
}

var eventDefinitions = map[string]struct{ signature, topic string }{
	"create_task":  {"TaskCreated(uint256,bytes32,address,address,uint64,uint8,bytes32)", "0x99a752deb59e73f9aa963354e3dc7ca6376de56f46c30ca28fce492261b7f015"},
	"assign_task":  {"TaskAssigned(uint256,address,address)", "0xfe58e4bb1e9a69b912e9ef1be9463a03d5d7aa99d2116726abd48e28acc4f91e"},
	"daily_report": {"DailyReportSubmitted(uint256,uint256,address,uint8,bytes32,bytes32,bytes32)", "0x2c5a57e4faacde47bea0b33281b2eb22094ed367d49b0c71340e7812064a96ae"},
	"delete_task":  {"TaskDeleted(uint256,address)", "0x342ff6c61d8ac95b75821982d3bac415a2f2e4f121b1fccda188bd67d31324b7"},
	"task_content": {"TaskContentRecorded(uint256,uint8,bytes32,address)", "0xb1f9efc020ef70f9a1917446d0da5975b390c7d86584a6b21b388dc7bcb652a3"},
}

func (v Verifier) Verify(ctx context.Context, payload map[string]any) (map[string]any, error) {
	parsedURL, err := url.Parse(v.Config.RPCURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || v.Config.ContractAddress == "" || v.Config.ChainID == "" {
		return nil, verificationError("Blockchain receipt verification is not configured on the API server.", http.StatusServiceUnavailable)
	}
	contract := strings.ToLower(v.Config.ContractAddress)
	if strings.ToLower(fmt.Sprint(payload["contract_address"])) != contract {
		return nil, verificationError("Transaction contract does not match the configured contract.", http.StatusBadRequest)
	}
	expectedChain, err := parseQuantity(v.Config.ChainID)
	if err != nil {
		return nil, verificationError("Invalid blockchain chain ID.", http.StatusServiceUnavailable)
	}
	payloadChain, err := parseQuantity(payload["chain_id"])
	if err != nil || payloadChain != expectedChain {
		return nil, verificationError("Transaction chain does not match the configured chain.", http.StatusBadRequest)
	}
	rpc := v.RPC
	if rpc == nil {
		rpc = HTTPRPC{URL: v.Config.RPCURL, Client: &http.Client{Timeout: v.Config.RPCTimeout}}
	}
	rpcChainRaw, err := rpc.Call(ctx, "eth_chainId", []any{})
	if err != nil {
		return nil, unavailableError()
	}
	rpcChain, err := parseQuantity(rpcChainRaw)
	if err != nil || rpcChain != expectedChain {
		return nil, verificationError("Configured RPC is connected to the wrong chain.", http.StatusServiceUnavailable)
	}
	txHash := strings.ToLower(fmt.Sprint(payload["transaction_hash"]))
	if !isHex(txHash, 32) {
		return nil, verificationError("Transaction hash must be a 32-byte 0x-prefixed hexadecimal value.", http.StatusBadRequest)
	}
	receipt, err := v.waitForReceipt(ctx, rpc, txHash)
	if err != nil {
		return nil, err
	}
	if strings.ToLower(fmt.Sprint(receipt["transactionHash"])) != txHash {
		return nil, verificationError("Transaction receipt does not match the submitted hash.", http.StatusBadRequest)
	}
	status, err := parseQuantity(receipt["status"])
	if err != nil || status != 1 {
		return nil, verificationError("The blockchain transaction reverted and was not recorded.", http.StatusBadRequest)
	}
	if strings.ToLower(fmt.Sprint(receipt["to"])) != contract {
		return nil, verificationError("Transaction was not sent to the configured contract.", http.StatusBadRequest)
	}
	eventType := fmt.Sprint(payload["event_type"])
	definition, ok := eventDefinitions[eventType]
	if !ok {
		return nil, verificationError("Unsupported blockchain event type.", http.StatusBadRequest)
	}
	logEntry := matchingLog(receipt["logs"], contract, definition.topic)
	if logEntry == nil {
		return nil, verificationError("Receipt does not contain the expected "+strings.Split(definition.signature, "(")[0]+" event.", http.StatusBadRequest)
	}
	if eventType != "create_task" && emptyValue(payload["expected_on_chain_task_id"]) {
		blockTag := "latest"
		if eventType == "delete_task" {
			blockNumber, blockErr := parseQuantity(receipt["blockNumber"])
			if blockErr != nil || blockNumber == 0 {
				return nil, verificationError("TaskDeleted receipt has no valid previous block.", http.StatusBadRequest)
			}
			blockTag = fmt.Sprintf("0x%x", blockNumber-1)
		}
		callData := "0x2fe7d983" + hashTaskValue("plane-issue:" + fmt.Sprint(payload["issue_id"]))[2:]
		resolved, resolveErr := rpc.Call(ctx, "eth_call", []any{map[string]any{"to": contract, "data": callData}, blockTag})
		if resolveErr != nil || !isHex(fmt.Sprint(resolved), 32) {
			return nil, verificationError("Blockchain RPC could not resolve this task ID.", http.StatusServiceUnavailable)
		}
		resolvedTaskID, parseErr := parseQuantity(resolved)
		if parseErr != nil {
			return nil, verificationError("Blockchain RPC returned an invalid task ID.", http.StatusServiceUnavailable)
		}
		payload["expected_on_chain_task_id"] = resolvedTaskID
	}
	metadata, err := validateEvent(eventType, payload, receipt, logEntry)
	if err != nil {
		return nil, err
	}
	blockNumber, _ := parseQuantity(receipt["blockNumber"])
	now := time.Now().UTC()
	if v.Now != nil {
		now = v.Now().UTC()
	}
	metadata["verified_at"] = now.Format(time.RFC3339)
	metadata["receipt_status"] = 1
	metadata["block_number"] = blockNumber
	metadata["event_signature"] = definition.signature
	metadata["event_topic"] = definition.topic
	metadata["log_index"] = logEntry["logIndex"]
	metadata["task_binding_verified"] = true
	return metadata, nil
}

func (v Verifier) waitForReceipt(ctx context.Context, rpc RPC, txHash string) (map[string]any, error) {
	deadline := time.Now().Add(v.Config.ReceiptWait)
	for {
		result, err := rpc.Call(ctx, "eth_getTransactionReceipt", []any{txHash})
		if err != nil {
			return nil, unavailableError()
		}
		if result != nil {
			receipt, ok := result.(map[string]any)
			if !ok {
				return nil, verificationError("Transaction receipt is invalid.", http.StatusBadRequest)
			}
			return receipt, nil
		}
		if !time.Now().Before(deadline) {
			return nil, verificationError("Transaction receipt is not available yet; retry after it is mined.", http.StatusConflict)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func validateEvent(eventType string, payload, receipt, logEntry map[string]any) (map[string]any, error) {
	topics := stringSlice(logEntry["topics"])
	if len(topics) < 2 || !isHex(topics[1], 32) {
		return nil, verificationError("Transaction event is missing task ID.", http.StatusBadRequest)
	}
	taskID, _ := parseQuantity(topics[1])
	if !emptyValue(payload["expected_on_chain_task_id"]) {
		expectedTaskID, expectedErr := parseQuantity(payload["expected_on_chain_task_id"])
		if expectedErr != nil || expectedTaskID != taskID {
			return nil, verificationError("Transaction event belongs to another on-chain task.", http.StatusBadRequest)
		}
	}
	from := strings.ToLower(fmt.Sprint(receipt["from"]))
	if !isHex(from, 20) {
		return nil, verificationError("Transaction receipt has no valid sender.", http.StatusBadRequest)
	}
	words, err := dataWords(logEntry["data"])
	if err != nil {
		return nil, err
	}
	switch eventType {
	case "create_task":
		if len(topics) < 4 || strings.ToLower(topics[2]) != hashTaskValue("plane-issue:"+fmt.Sprint(payload["issue_id"])) {
			return nil, verificationError("TaskCreated external ID does not match the submitted task.", http.StatusBadRequest)
		}
		if topicAddress(topics[3]) != from {
			return nil, verificationError("TaskCreated creator does not match the transaction sender.", http.StatusBadRequest)
		}
		expected := strings.ToLower(fmt.Sprint(payload["assignee_wallet"]))
		if expected == "" || expected == "<nil>" {
			expected = "0x" + strings.Repeat("0", 40)
		}
		if len(words) < 1 || wordAddress(words[0]) != expected {
			return nil, verificationError("TaskCreated assignee does not match the submitted employee wallet.", http.StatusBadRequest)
		}
	case "assign_task":
		if len(topics) < 4 || topicAddress(topics[3]) != strings.ToLower(fmt.Sprint(payload["assignee_wallet"])) {
			return nil, verificationError("TaskAssigned employee wallet does not match the submitted assignment.", http.StatusBadRequest)
		}
	case "daily_report":
		if len(topics) < 4 || topicAddress(topics[3]) != from || len(words) < 4 {
			return nil, verificationError("DailyReport event does not match the submitted report.", http.StatusBadRequest)
		}
		progress, progressErr := parseQuantity(payload["progress"])
		actualProgress, actualProgressErr := parseQuantity(words[0])
		if progressErr != nil || actualProgressErr != nil || progress != actualProgress ||
			strings.ToLower(words[1]) != hashTaskValue(fmt.Sprint(payload["work"])) ||
			strings.ToLower(words[2]) != hashTaskValue(fmt.Sprint(payload["difficulty"])) ||
			strings.ToLower(words[3]) != hashTaskValue(fmt.Sprint(payload["evidence"])) {
			return nil, verificationError("DailyReport content does not match the submitted report.", http.StatusBadRequest)
		}
	case "delete_task":
		if len(topics) < 3 || topicAddress(topics[2]) != from {
			return nil, verificationError("TaskDeleted actor does not match the transaction sender.", http.StatusBadRequest)
		}
	case "task_content":
		kinds := map[string]uint64{"comment": 0, "attachment": 1, "evidence": 2}
		kind, exists := kinds[fmt.Sprint(payload["content_kind"])]
		actualKind, kindErr := parseQuantity(valueAt(topics, 2))
		if !exists || kindErr != nil || actualKind != kind || strings.ToLower(valueAt(topics, 3)) != strings.ToLower(fmt.Sprint(payload["content_hash"])) || len(words) < 1 || wordAddress(words[0]) != from {
			return nil, verificationError("TaskContent event does not match the submitted content.", http.StatusBadRequest)
		}
	}
	return map[string]any{"on_chain_task_id": taskID, "transaction_from": from}, nil
}

func matchingLog(raw any, contract, topic string) map[string]any {
	logs, _ := raw.([]any)
	for _, item := range logs {
		entry, ok := item.(map[string]any)
		if !ok || strings.ToLower(fmt.Sprint(entry["address"])) != contract {
			continue
		}
		topics := stringSlice(entry["topics"])
		if len(topics) > 0 && strings.ToLower(topics[0]) == topic {
			return entry
		}
	}
	return nil
}

func dataWords(raw any) ([]string, error) {
	data := strings.ToLower(fmt.Sprint(raw))
	if data == "<nil>" {
		data = "0x"
	}
	if !strings.HasPrefix(data, "0x") || len(data[2:])%64 != 0 {
		return nil, verificationError("Transaction event data is not valid ABI data.", http.StatusBadRequest)
	}
	if _, err := hex.DecodeString(data[2:]); err != nil {
		return nil, verificationError("Transaction event data is not valid ABI data.", http.StatusBadRequest)
	}
	words := make([]string, 0, len(data[2:])/64)
	for index := 2; index < len(data); index += 64 {
		words = append(words, "0x"+data[index:index+64])
	}
	return words, nil
}

func parseQuantity(value any) (uint64, error) {
	text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	base := 10
	if strings.HasPrefix(text, "0x") {
		base, text = 16, text[2:]
	}
	return strconv.ParseUint(text, base, 64)
}

func hashTaskValue(value string) string {
	hash := sha256.Sum256([]byte(value))
	return "0x" + hex.EncodeToString(hash[:])
}

func isHex(value string, bytes int) bool {
	if !strings.HasPrefix(value, "0x") || len(value) != 2+bytes*2 {
		return false
	}
	_, err := hex.DecodeString(value[2:])
	return err == nil
}

func stringSlice(value any) []string {
	raw, _ := value.([]any)
	result := make([]string, len(raw))
	for i, item := range raw {
		result[i] = strings.ToLower(fmt.Sprint(item))
	}
	return result
}

func topicAddress(word string) string {
	if !isHex(word, 32) {
		return ""
	}
	return "0x" + strings.ToLower(word[len(word)-40:])
}
func wordAddress(word string) string {
	if !isHex(word, 32) {
		return ""
	}
	return "0x" + strings.ToLower(word[len(word)-40:])
}
func valueAt(values []string, index int) string {
	if index >= len(values) {
		return ""
	}
	return values[index]
}
func emptyValue(value any) bool {
	text := fmt.Sprint(value)
	return value == nil || text == "" || text == "<nil>"
}
func verificationError(message string, status int) error {
	return VerificationError{Message: message, Status: status}
}
func unavailableError() error {
	return verificationError("Blockchain RPC is unavailable; the transaction was not recorded.", http.StatusServiceUnavailable)
}
