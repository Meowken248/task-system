import pytest
from rest_framework import serializers

from plane.app.serializers.user import UserSerializer


@pytest.mark.unit
@pytest.mark.parametrize(
    "address",
    [
        "0x" + "1a" * 20,
        "0x" + "AB" * 20,
    ],
)
def test_accepts_valid_metanode_wallet_address(address):
    assert UserSerializer().validate_metanode_wallet_address(address) == address.lower()


@pytest.mark.unit
@pytest.mark.parametrize(
    "address",
    [
        "1a" * 20,
        "0x1234",
        "0x" + "gg" * 20,
    ],
)
def test_rejects_invalid_metanode_wallet_address(address):
    with pytest.raises(serializers.ValidationError):
        UserSerializer().validate_metanode_wallet_address(address)


@pytest.mark.unit
def test_normalizes_empty_metanode_wallet_address_to_none():
    serializer = UserSerializer()
    assert serializer.validate_metanode_wallet_address("") is None
    assert serializer.validate_metanode_wallet_address(None) is None
