package blockchain

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

const (
	testContract = "0x1111111111111111111111111111111111111111"
	testSender   = "0x2222222222222222222222222222222222222222"
	testAssignee = "0x3333333333333333333333333333333333333333"
	testHash     = "0x4444444444444444444444444444444444444444444444444444444444444444"
)

type rpcStub struct {
	receipt any
}

func (s rpcStub) Call(_ context.Context, method string, _ []any) (any, error) {
	if method == "eth_chainId" {
		return "0x3df", nil
	}
	return s.receipt, nil
}

func TestVerifyTaskCreatedReceipt(t *testing.T) {
	issueID := "issue-1"
	receipt := map[string]any{
		"transactionHash": testHash, "status": "0x1", "to": testContract, "from": testSender, "blockNumber": "0x10",
		"logs": []any{map[string]any{
			"address": testContract,
			"topics":  []any{eventDefinitions["create_task"].topic, "0x" + fmt.Sprintf("%064x", 0), hashTaskValue("plane-issue:" + issueID), addressWord(testSender)},
			"data":    "0x" + addressWord(testAssignee)[2:] + fmt.Sprintf("%0192x", 0), "logIndex": "0x0",
		}},
	}
	verifier := Verifier{Config: testConfig(), RPC: rpcStub{receipt: receipt}, Now: func() time.Time { return time.Unix(1, 0) }}
	result, err := verifier.Verify(context.Background(), map[string]any{
		"event_type": "create_task", "issue_id": issueID, "transaction_hash": testHash,
		"contract_address": testContract, "chain_id": 991, "assignee_wallet": testAssignee,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["on_chain_task_id"] != uint64(0) || result["transaction_from"] != testSender {
		t.Fatalf("unexpected metadata: %#v", result)
	}
}

func TestVerifyRejectsMissingEvent(t *testing.T) {
	receipt := map[string]any{"transactionHash": testHash, "status": "0x1", "to": testContract, "from": testSender, "logs": []any{}}
	verifier := Verifier{Config: testConfig(), RPC: rpcStub{receipt: receipt}}
	_, err := verifier.Verify(context.Background(), map[string]any{
		"event_type": "create_task", "issue_id": "issue", "transaction_hash": testHash,
		"contract_address": testContract, "chain_id": 991,
	})
	if err == nil {
		t.Fatal("expected missing event error")
	}
}

func TestVerifyUnminedReceiptIsRetryable(t *testing.T) {
	verifier := Verifier{Config: Config{RPCURL: "https://rpc.invalid", ContractAddress: testContract, ChainID: "991", ReceiptWait: 0}, RPC: rpcStub{receipt: nil}}
	_, err := verifier.Verify(context.Background(), map[string]any{
		"event_type": "create_task", "transaction_hash": testHash, "contract_address": testContract, "chain_id": 991,
	})
	verificationErr, ok := err.(VerificationError)
	if !ok || verificationErr.Status != 409 {
		t.Fatalf("error = %#v", err)
	}
}

func testConfig() Config {
	return Config{RPCURL: "https://rpc.invalid", ContractAddress: testContract, ChainID: "991", RPCTimeout: time.Second, ReceiptWait: 0}
}

func addressWord(address string) string { return "0x" + strings.Repeat("0", 24) + address[2:] }

type pingRPCStub struct {
	chainIdVal any
	chainIdErr error
	getCodeVal any
	getCodeErr error
}

func (s pingRPCStub) Call(_ context.Context, method string, _ []any) (any, error) {
	if method == "eth_chainId" {
		if s.chainIdErr != nil {
			return nil, s.chainIdErr
		}
		return s.chainIdVal, nil
	}
	if method == "eth_getCode" {
		if s.getCodeErr != nil {
			return nil, s.getCodeErr
		}
		return s.getCodeVal, nil
	}
	return nil, fmt.Errorf("unknown method: %s", method)
}

func TestPingContextSuccess(t *testing.T) {
	verifier := Verifier{
		Config: Config{RPCURL: "https://rpc.invalid", ContractAddress: testContract, ChainID: "991"},
		RPC: pingRPCStub{
			chainIdVal: "0x3df", // 991 decimal
			getCodeVal: "0x60806040",
		},
	}
	if err := verifier.PingContext(context.Background()); err != nil {
		t.Fatalf("expected success, got err: %v", err)
	}
}

func TestPingContextRPCUnreachable(t *testing.T) {
	verifier := Verifier{
		Config: Config{RPCURL: "https://rpc.invalid", ContractAddress: testContract, ChainID: "991"},
		RPC: pingRPCStub{
			chainIdErr: fmt.Errorf("connection refused"),
		},
	}
	err := verifier.PingContext(context.Background())
	if err == nil || !strings.Contains(err.Error(), "RPC unreachable") {
		t.Fatalf("expected RPC unreachable error, got: %v", err)
	}
}

func TestPingContextWrongChainID(t *testing.T) {
	verifier := Verifier{
		Config: Config{RPCURL: "https://rpc.invalid", ContractAddress: testContract, ChainID: "991"},
		RPC: pingRPCStub{
			chainIdVal: "0x1", // chain ID 1
		},
	}
	err := verifier.PingContext(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Wrong Chain ID") {
		t.Fatalf("expected Wrong Chain ID error, got: %v", err)
	}
}

func TestPingContextContractNotDeployed(t *testing.T) {
	verifier := Verifier{
		Config: Config{RPCURL: "https://rpc.invalid", ContractAddress: testContract, ChainID: "991"},
		RPC: pingRPCStub{
			chainIdVal: "0x3df",
			getCodeVal: "0x", // empty bytecode
		},
	}
	err := verifier.PingContext(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Contract not deployed") {
		t.Fatalf("expected Contract not deployed error, got: %v", err)
	}
}
