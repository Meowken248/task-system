"""Verify browser-supplied blockchain transaction hashes through JSON-RPC."""

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from rest_framework import status

_EVENTS = {
    "create_task": (
        "TaskCreated(uint256,bytes32,address,address,uint64,uint8,bytes32)",
        "0x99a752deb59e73f9aa963354e3dc7ca6376de56f46c30ca28fce492261b7f015",
    ),
    "assign_task": (
        "TaskAssigned(uint256,address,address)",
        "0xfe58e4bb1e9a69b912e9ef1be9463a03d5d7aa99d2116726abd48e28acc4f91e",
    ),
    "daily_report": (
        "DailyReportSubmitted(uint256,uint256,address,uint8,bytes32,bytes32,bytes32)",
        "0x2c5a57e4faacde47bea0b33281b2eb22094ed367d49b0c71340e7812064a96ae",
    ),
    "delete_task": (
        "TaskDeleted(uint256,address)",
        "0x342ff6c61d8ac95b75821982d3bac415a2f2e4f121b1fccda188bd67d31324b7",
    ),
    "task_content": (
        "TaskContentRecorded(uint256,uint8,bytes32,address)",
        "0xb1f9efc020ef70f9a1917446d0da5975b390c7d86584a6b21b388dc7bcb652a3",
    ),
}
_HASH_32_PATTERN = re.compile(r"^0x[a-fA-F0-9]{64}$")
_ADDRESS_PATTERN = re.compile(r"^0x[a-fA-F0-9]{40}$")
_GET_TASK_ID_SELECTOR = "2fe7d983"


@dataclass(frozen=True)
class BlockchainVerificationError(Exception):
    message: str
    status_code: int = status.HTTP_400_BAD_REQUEST

    def __str__(self) -> str:
        return self.message


def _configuration_value(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def _parse_quantity(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError
    if isinstance(value, int):
        return value
    text = str(value).strip().lower()
    if not text:
        raise ValueError
    return int(text, 16 if text.startswith("0x") else 10)


def _rpc_call(rpc_url: str, method: str, params: list[Any], timeout_seconds: float) -> Any:
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, separators=(",", ":")
    ).encode("utf-8")
    request = Request(
        rpc_url,
        data=body,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            result = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        raise BlockchainVerificationError(
            "Blockchain RPC is unavailable; the transaction was not recorded.",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        ) from exc
    if not isinstance(result, dict) or result.get("error"):
        raise BlockchainVerificationError(
            "Blockchain RPC rejected the verification request; the transaction was not recorded.",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return result.get("result")


def _hash_task_value(value: str) -> str:
    return "0x" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _topic_word(topics: list, index: int, field_name: str) -> str:
    if index >= len(topics):
        raise BlockchainVerificationError(f"Transaction event is missing {field_name}.")
    value = str(topics[index]).lower()
    if not _HASH_32_PATTERN.fullmatch(value):
        raise BlockchainVerificationError(f"Transaction event contains an invalid {field_name}.")
    return value


def _topic_address(topics: list, index: int, field_name: str) -> str:
    return "0x" + _topic_word(topics, index, field_name)[-40:]


def _data_words(log: dict) -> list[str]:
    data = str(log.get("data", "0x")).lower()
    if not data.startswith("0x") or len(data[2:]) % 64 != 0 or not re.fullmatch(r"[a-f0-9]*", data[2:]):
        raise BlockchainVerificationError("Transaction event data is not valid ABI data.")
    return ["0x" + data[index : index + 64] for index in range(2, len(data), 64)]


def _word_address(words: list[str], index: int, field_name: str) -> str:
    if index >= len(words):
        raise BlockchainVerificationError(f"Transaction event data is missing {field_name}.")
    return "0x" + words[index][-40:]


def _validate_event_payload(event_type: str, payload: dict, receipt: dict, log: dict) -> dict:
    topics = log.get("topics")
    if not isinstance(topics, list):
        raise BlockchainVerificationError("Transaction event topics are invalid.")
    transaction_from = str(receipt.get("from", "")).lower()
    if not _ADDRESS_PATTERN.fullmatch(transaction_from):
        raise BlockchainVerificationError("Transaction receipt has no valid sender.")
    task_id = int(_topic_word(topics, 1, "task ID"), 16)
    expected_task_id = payload.get("expected_on_chain_task_id")
    if expected_task_id not in (None, "") and task_id != int(expected_task_id):
        raise BlockchainVerificationError("Transaction event belongs to another on-chain task.")

    if event_type == "create_task":
        if _topic_word(topics, 2, "external ID") != _hash_task_value(f"plane-issue:{payload['issue_id']}"):
            raise BlockchainVerificationError("TaskCreated external ID does not match the submitted task.")
        if _topic_address(topics, 3, "creator") != transaction_from:
            raise BlockchainVerificationError("TaskCreated creator does not match the transaction sender.")
        expected_assignee = str(payload.get("assignee_wallet") or "0x" + "0" * 40).lower()
        if _word_address(_data_words(log), 0, "assignee") != expected_assignee:
            raise BlockchainVerificationError("TaskCreated assignee does not match the submitted employee wallet.")
    elif event_type == "assign_task":
        if _topic_address(topics, 3, "new assignee") != str(payload["assignee_wallet"]).lower():
            raise BlockchainVerificationError("TaskAssigned employee wallet does not match the submitted assignment.")
    elif event_type == "daily_report":
        if _topic_address(topics, 3, "reporter") != transaction_from:
            raise BlockchainVerificationError("DailyReport reporter does not match the transaction sender.")
        words = _data_words(log)
        expected_words = [
            int(payload["progress"]),
            int(_hash_task_value(str(payload.get("work", ""))), 16),
            int(_hash_task_value(str(payload.get("difficulty", ""))), 16),
            int(_hash_task_value(str(payload.get("evidence", ""))), 16),
        ]
        if len(words) < 4 or [int(word, 16) for word in words[:4]] != expected_words:
            raise BlockchainVerificationError("DailyReport content does not match the submitted report.")
    elif event_type == "delete_task":
        if _topic_address(topics, 2, "deleted by") != transaction_from:
            raise BlockchainVerificationError("TaskDeleted actor does not match the transaction sender.")
    elif event_type == "task_content":
        expected_kind = {"comment": 0, "attachment": 1, "evidence": 2}[payload["content_kind"]]
        if int(_topic_word(topics, 2, "content kind"), 16) != expected_kind:
            raise BlockchainVerificationError("TaskContent kind does not match the submitted content.")
        if _topic_word(topics, 3, "content hash") != str(payload["content_hash"]).lower():
            raise BlockchainVerificationError("TaskContent hash does not match the submitted content.")
        if _word_address(_data_words(log), 0, "recorded by") != transaction_from:
            raise BlockchainVerificationError("TaskContent actor does not match the transaction sender.")
    return {"on_chain_task_id": task_id, "transaction_from": transaction_from}


def verify_blockchain_transaction(payload: dict) -> dict:
    """Confirm chain, successful receipt, contract and semantic event payload."""

    rpc_url = _configuration_value("BLOCKCHAIN_RPC_URL", "RPC_URL", "VITE_RPC_URL")
    contract_address = _configuration_value("BLOCKCHAIN_CONTRACT_ADDRESS", "VITE_CONTRACT_ADDRESS").lower()
    configured_chain_id = _configuration_value("BLOCKCHAIN_CHAIN_ID", "CHAIN_ID", "VITE_CHAIN_ID")
    if not rpc_url or not contract_address or not configured_chain_id:
        raise BlockchainVerificationError(
            "Blockchain receipt verification is not configured on the API server.",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if urlparse(rpc_url).scheme not in {"http", "https"}:
        raise BlockchainVerificationError(
            "Blockchain RPC URL must use HTTP or HTTPS.",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if str(payload.get("contract_address", "")).lower() != contract_address:
        raise BlockchainVerificationError("Transaction contract does not match the configured contract.")
    try:
        expected_chain_id = _parse_quantity(configured_chain_id)
        if _parse_quantity(payload.get("chain_id")) != expected_chain_id:
            raise BlockchainVerificationError("Transaction chain does not match the configured chain.")
    except (TypeError, ValueError):
        raise BlockchainVerificationError("Invalid blockchain chain ID.") from None
    try:
        timeout_seconds = max(1.0, min(float(_configuration_value("BLOCKCHAIN_RPC_TIMEOUT_SECONDS") or "8"), 30.0))
        wait_seconds = max(0.0, min(float(_configuration_value("BLOCKCHAIN_RECEIPT_WAIT_SECONDS") or "15"), 60.0))
    except ValueError:
        raise BlockchainVerificationError(
            "Blockchain timeout configuration is invalid.",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        ) from None
    try:
        rpc_chain_id = _parse_quantity(_rpc_call(rpc_url, "eth_chainId", [], timeout_seconds))
    except (TypeError, ValueError) as exc:
        raise BlockchainVerificationError(
            "Blockchain RPC returned an invalid chain ID.", status.HTTP_503_SERVICE_UNAVAILABLE
        ) from exc
    if rpc_chain_id != expected_chain_id:
        raise BlockchainVerificationError("Configured RPC is connected to the wrong chain.")

    transaction_hash = str(payload["transaction_hash"]).lower()
    deadline = time.monotonic() + wait_seconds
    receipt = None
    while receipt is None:
        receipt = _rpc_call(rpc_url, "eth_getTransactionReceipt", [transaction_hash], timeout_seconds)
        if receipt is not None or time.monotonic() >= deadline:
            break
        time.sleep(0.5)
    if receipt is None:
        raise BlockchainVerificationError(
            "Transaction receipt is not available yet; retry after it is mined.", status.HTTP_409_CONFLICT
        )
    if not isinstance(receipt, dict) or str(receipt.get("transactionHash", "")).lower() != transaction_hash:
        raise BlockchainVerificationError("Transaction receipt does not match the submitted hash.")
    try:
        receipt_status = _parse_quantity(receipt.get("status"))
    except (TypeError, ValueError) as exc:
        raise BlockchainVerificationError("Transaction receipt contains an invalid status.") from exc
    if receipt_status != 1:
        raise BlockchainVerificationError("The blockchain transaction reverted and was not recorded.")
    if str(receipt.get("to", "")).lower() != contract_address:
        raise BlockchainVerificationError("Transaction was not sent to the configured contract.")

    event_type = str(payload.get("event_type", ""))
    event_definition = _EVENTS.get(event_type)
    if not event_definition:
        raise BlockchainVerificationError("Unsupported blockchain event type.")
    signature, expected_topic = event_definition
    matching_log = next(
        (
            log
            for log in receipt.get("logs", [])
            if isinstance(log, dict)
            and str(log.get("address", "")).lower() == contract_address
            and isinstance(log.get("topics"), list)
            and log["topics"]
            and str(log["topics"][0]).lower() == expected_topic
        ),
        None,
    )
    if matching_log is None:
        raise BlockchainVerificationError(f"Receipt does not contain the expected {signature.split('(', 1)[0]} event.")
    if event_type != "create_task" and payload.get("expected_on_chain_task_id") in (None, ""):
        external_id = _hash_task_value(f"plane-issue:{payload['issue_id']}")
        block_tag = "latest"
        if event_type == "delete_task":
            try:
                receipt_block = _parse_quantity(receipt.get("blockNumber"))
            except (TypeError, ValueError) as exc:
                raise BlockchainVerificationError(
                    "TaskDeleted receipt has no valid block number."
                ) from exc
            if receipt_block <= 0:
                raise BlockchainVerificationError(
                    "TaskDeleted receipt cannot be checked against the previous block."
                )
            block_tag = hex(receipt_block - 1)
        result = _rpc_call(
            rpc_url,
            "eth_call",
            [{"to": contract_address, "data": "0x" + _GET_TASK_ID_SELECTOR + external_id[2:]}, block_tag],
            timeout_seconds,
        )
        if not isinstance(result, str) or not _HASH_32_PATTERN.fullmatch(result):
            raise BlockchainVerificationError("Blockchain RPC could not resolve this task ID.")
        payload = {**payload, "expected_on_chain_task_id": int(result, 16)}
    metadata = _validate_event_payload(event_type, payload, receipt, matching_log)
    try:
        block_number = _parse_quantity(receipt.get("blockNumber"))
    except (TypeError, ValueError):
        block_number = None
    return {
        "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "receipt_status": 1,
        "block_number": block_number,
        **metadata,
        "task_binding_verified": event_type == "create_task"
        or payload.get("expected_on_chain_task_id") not in (None, ""),
        "event_signature": signature,
        "event_topic": expected_topic,
        "log_index": matching_log.get("logIndex"),
    }
