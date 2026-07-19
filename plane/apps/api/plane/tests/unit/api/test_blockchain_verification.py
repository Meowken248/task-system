import pytest

from plane.api.views import blockchain_verification as verification


CONTRACT = "0x" + "11" * 20
SENDER = "0x" + "22" * 20
ASSIGNEE = "0x" + "33" * 20
TX_HASH = "0x" + "44" * 32


def _topic_address(address: str) -> str:
    return "0x" + "0" * 24 + address[2:].lower()


def _word_address(address: str) -> str:
    return "0" * 24 + address[2:].lower()


@pytest.fixture(autouse=True)
def blockchain_environment(monkeypatch):
    monkeypatch.setenv("BLOCKCHAIN_RPC_URL", "https://rpc.invalid")
    monkeypatch.setenv("BLOCKCHAIN_CHAIN_ID", "991")
    monkeypatch.setenv("BLOCKCHAIN_CONTRACT_ADDRESS", CONTRACT)
    monkeypatch.setenv("BLOCKCHAIN_RECEIPT_WAIT_SECONDS", "0")


@pytest.mark.unit
def test_verifies_successful_task_created_receipt(monkeypatch):
    issue_id = "issue-1"
    event_topic = verification._EVENTS["create_task"][1]
    receipt = {
        "transactionHash": TX_HASH,
        "status": "0x1",
        "to": CONTRACT,
        "from": SENDER,
        "blockNumber": "0x10",
        "logs": [
            {
                "address": CONTRACT,
                "topics": [
                    event_topic,
                    "0x" + "0" * 64,
                    verification._hash_task_value(f"plane-issue:{issue_id}"),
                    _topic_address(SENDER),
                ],
                "data": "0x" + _word_address(ASSIGNEE) + "0" * 192,
                "logIndex": "0x0",
            }
        ],
    }

    def rpc_call(_url, method, _params, _timeout):
        return "0x3df" if method == "eth_chainId" else receipt

    monkeypatch.setattr(verification, "_rpc_call", rpc_call)
    result = verification.verify_blockchain_transaction(
        {
            "event_type": "create_task",
            "issue_id": issue_id,
            "transaction_hash": TX_HASH,
            "contract_address": CONTRACT,
            "chain_id": 991,
            "assignee_wallet": ASSIGNEE,
        }
    )

    assert result["receipt_status"] == 1
    assert result["on_chain_task_id"] == 0
    assert result["transaction_from"] == SENDER


@pytest.mark.unit
def test_rejects_receipt_without_expected_contract_event(monkeypatch):
    receipt = {
        "transactionHash": TX_HASH,
        "status": "0x1",
        "to": CONTRACT,
        "from": SENDER,
        "logs": [],
    }
    monkeypatch.setattr(
        verification,
        "_rpc_call",
        lambda _url, method, _params, _timeout: "0x3df" if method == "eth_chainId" else receipt,
    )

    with pytest.raises(verification.BlockchainVerificationError, match="TaskCreated"):
        verification.verify_blockchain_transaction(
            {
                "event_type": "create_task",
                "issue_id": "issue-1",
                "transaction_hash": TX_HASH,
                "contract_address": CONTRACT,
                "chain_id": 991,
                "assignee_wallet": ASSIGNEE,
            }
        )


@pytest.mark.unit
def test_unmined_receipt_is_retryable(monkeypatch):
    monkeypatch.setattr(
        verification,
        "_rpc_call",
        lambda _url, method, _params, _timeout: "0x3df" if method == "eth_chainId" else None,
    )

    with pytest.raises(verification.BlockchainVerificationError) as error:
        verification.verify_blockchain_transaction(
            {
                "event_type": "create_task",
                "issue_id": "issue-1",
                "transaction_hash": TX_HASH,
                "contract_address": CONTRACT,
                "chain_id": 991,
                "assignee_wallet": ASSIGNEE,
            }
        )

    assert error.value.status_code == 409


@pytest.mark.unit
def test_delete_resolves_task_binding_at_block_before_deletion(monkeypatch):
    issue_id = "issue-to-delete"
    task_id = 7
    receipt = {
        "transactionHash": TX_HASH,
        "status": "0x1",
        "to": CONTRACT,
        "from": SENDER,
        "blockNumber": "0x10",
        "logs": [
            {
                "address": CONTRACT,
                "topics": [
                    verification._EVENTS["delete_task"][1],
                    "0x" + f"{task_id:064x}",
                    _topic_address(SENDER),
                ],
                "data": "0x",
                "logIndex": "0x0",
            }
        ],
    }

    def rpc_call(_url, method, params, _timeout):
        if method == "eth_chainId":
            return "0x3df"
        if method == "eth_getTransactionReceipt":
            return receipt
        assert method == "eth_call"
        assert params[0]["data"].endswith(verification._hash_task_value(f"plane-issue:{issue_id}")[2:])
        assert params[1] == "0xf"
        return "0x" + f"{task_id:064x}"

    monkeypatch.setattr(verification, "_rpc_call", rpc_call)
    result = verification.verify_blockchain_transaction(
        {
            "event_type": "delete_task",
            "issue_id": issue_id,
            "transaction_hash": TX_HASH,
            "contract_address": CONTRACT,
            "chain_id": 991,
        }
    )

    assert result["on_chain_task_id"] == task_id
    assert result["task_binding_verified"] is True
