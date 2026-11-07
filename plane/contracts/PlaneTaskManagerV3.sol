// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./PlaneTaskManager.sol";

interface IPlaneWorkspaceMembership {
    function getMemberRole(string calldata slug, address member) external view returns (uint8);
}

/// @notice New deployment only. Existing V2 addresses are not upgraded by changing source.
contract PlaneTaskManagerV3 is PlaneTaskManager {
    IPlaneWorkspaceMembership public immutable workspaceRegistry;
    mapping(uint256 => string) private taskWorkspaces;
    error WorkspaceRequired();
    event TaskWorkspaceBound(uint256 indexed taskId, string workspaceSlug);

    constructor(address registry) {
        if (registry == address(0) || registry.code.length == 0) revert InvalidAddress();
        workspaceRegistry = IPlaneWorkspaceMembership(registry);
    }

    function contractVersion() external pure override returns (uint256) { return 3; }

    function createTask(bytes32, bytes32, address, uint64, Priority) external pure override returns (uint256) {
        revert WorkspaceRequired();
    }

    function createWorkspaceTask(string calldata slug, bytes32 externalId, bytes32 metadataHash, address assignee, uint64 dueAt, Priority priority)
        external returns (uint256 taskId)
    {
        _requireMember(slug, msg.sender);
        if (assignee != address(0)) _requireMember(slug, assignee);
        taskId = _createTask(externalId, metadataHash, assignee, dueAt, priority);
        taskWorkspaces[taskId] = slug;
        emit TaskWorkspaceBound(taskId, slug);
    }

    function getTaskWorkspace(uint256 taskId) external view taskExists(taskId) returns (string memory) { return taskWorkspaces[taskId]; }

    function _requireMember(string memory slug, address account) private view {
        if (bytes(slug).length == 0) revert WorkspaceRequired();
        if (workspaceRegistry.getMemberRole(slug, account) == 0) revert Unauthorized();
    }
    function _requireTaskWriter(uint256 taskId) internal view override { _requireMember(taskWorkspaces[taskId], msg.sender); }
    function _requireAssignee(uint256 taskId, address assignee) internal view override {
        if (assignee != address(0)) _requireMember(taskWorkspaces[taskId], assignee);
    }
    function _onChildTaskCreated(uint256 parentId, uint256 childId) internal override {
        string memory slug = taskWorkspaces[parentId];
        // The new child inherits its parent's workspace, including assignee validation.
        Task memory child = this.getTask(childId);
        if (child.assignee != address(0)) _requireMember(slug, child.assignee);
        taskWorkspaces[childId] = slug;
        emit TaskWorkspaceBound(childId, slug);
    }
}
