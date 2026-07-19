// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PlaneTaskManager
/// @notice On-chain task state and audit trail for Plane. Detailed/private data
///         stays in Plane; only stable identifiers and content hashes are stored.
contract PlaneTaskManager {
    enum Status {
        Todo,
        InProgress,
        Completed,
        Cancelled
    }

    enum Priority {
        None,
        Low,
        Medium,
        High,
        Urgent
    }

    enum ContentKind {
        Comment,
        Attachment,
        Evidence
    }

    enum ScheduleStatus {
        Unscheduled,
        OnSchedule,
        Delayed,
        Overdue,
        Completed,
        Cancelled
    }

    enum SubTaskStatus {
        Todo,
        InProgress,
        Completed,
        Cancelled
    }

    struct Task {
        bytes32 externalId;
        bytes32 metadataHash;
        address creator;
        address assignee;
        uint64 createdAt;
        uint64 updatedAt;
        uint64 dueAt;
        uint8 progress;
        Priority priority;
        Status status;
        bool deleted;
    }

    struct DailyReport {
        uint64 reportedAt;
        uint8 progress;
        bytes32 workHash;
        bytes32 difficultyHash;
        bytes32 evidenceHash;
    }

    struct SubTask {
        bytes32 externalId;
        bytes32 metadataHash;
        uint64 createdAt;
        uint64 updatedAt;
        uint8 progress;
        SubTaskStatus status;
        bool deleted;
    }

    struct ContentRecord {
        address recordedBy;
        uint64 recordedAt;
        ContentKind kind;
        bytes32 contentHash;
    }

    struct KPI {
        uint256 total;
        uint256 todo;
        uint256 completed;
        uint256 inProgress;
        uint256 cancelled;
        uint256 onSchedule;
        uint256 delayed;
        uint256 overdue;
        uint256 progressSum;
        uint256 averageProgress;
    }

    address public owner;
    uint256 public taskCount;

    mapping(address => bool) public admins;
    mapping(uint256 => Task) private tasks;
    mapping(bytes32 => uint256) private taskIdByExternalIdPlusOne;
    mapping(uint256 => DailyReport[]) private reports;
    mapping(uint256 => ContentRecord[]) private contentRecords;
    mapping(uint256 => SubTask[]) private subTasks;
    mapping(uint256 => mapping(bytes32 => uint256)) private subTaskIdByExternalIdPlusOne;
    mapping(uint256 => mapping(uint256 => uint256)) private childTaskIdBySubTaskPlusOne;
    mapping(address => uint256[]) private assignedTaskIds;
    mapping(address => mapping(uint256 => bool)) private taskIndexedForAssignee;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AdminUpdated(address indexed account, bool enabled);
    event TaskCreated(
        uint256 indexed taskId,
        bytes32 indexed externalId,
        address indexed creator,
        address assignee,
        uint64 dueAt,
        Priority priority,
        bytes32 metadataHash
    );
    event TaskMetadataUpdated(uint256 indexed taskId, bytes32 metadataHash);
    event TaskAssigned(uint256 indexed taskId, address indexed previousAssignee, address indexed newAssignee);
    event TaskScheduleUpdated(uint256 indexed taskId, uint64 dueAt, Priority priority);
    event TaskProgressUpdated(uint256 indexed taskId, uint8 progress, Status status, address indexed updatedBy);
    event TaskDeleted(uint256 indexed taskId, address indexed deletedBy);
    event TaskContentRecorded(
        uint256 indexed taskId, ContentKind indexed kind, bytes32 indexed contentHash, address recordedBy
    );
    event DailyReportSubmitted(
        uint256 indexed taskId,
        uint256 indexed reportId,
        address indexed reporter,
        uint8 progress,
        bytes32 workHash,
        bytes32 difficultyHash,
        bytes32 evidenceHash
    );
    event SubTaskCreated(
        uint256 indexed taskId,
        uint256 indexed subTaskId,
        bytes32 indexed externalId,
        bytes32 metadataHash
    );
    event SubTaskStatusUpdated(
        uint256 indexed taskId,
        uint256 indexed subTaskId,
        SubTaskStatus status,
        address indexed updatedBy
    );
    event SubTaskProgressUpdated(
        uint256 indexed taskId,
        uint256 indexed subTaskId,
        uint8 progress,
        SubTaskStatus status,
        address indexed updatedBy
    );
    event SubTaskDeleted(uint256 indexed taskId, uint256 indexed subTaskId);

    error Unauthorized();
    error InvalidAddress();
    error InvalidExternalId();
    error InvalidProgress();
    error InvalidTask();
    error DuplicateExternalId();
    error InvalidStatusTransition();
    error InvalidSubTask();
    error DuplicateSubTask();
    error InvalidHierarchy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyAdmin() {
        if (!admins[msg.sender]) revert Unauthorized();
        _;
    }

    modifier taskExists(uint256 taskId) {
        if (taskId >= taskCount || tasks[taskId].deleted) revert InvalidTask();
        _;
    }

    constructor() {
        owner = msg.sender;
        admins[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit AdminUpdated(msg.sender, true);
    }

    function contractVersion() external pure returns (uint256) {
        return 2;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previousOwner = owner;
        owner = newOwner;
        admins[newOwner] = true;
        emit OwnershipTransferred(previousOwner, newOwner);
        emit AdminUpdated(newOwner, true);
    }

    function setAdmin(address account, bool enabled) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        if (account == owner && !enabled) revert Unauthorized();
        admins[account] = enabled;
        emit AdminUpdated(account, enabled);
    }

    function createTask(
        bytes32 externalId,
        bytes32 metadataHash,
        address assignee,
        uint64 dueAt,
        Priority priority
    ) external onlyAdmin returns (uint256 taskId) {
        return _createTask(externalId, metadataHash, assignee, dueAt, priority);
    }

    function _createTask(
        bytes32 externalId,
        bytes32 metadataHash,
        address assignee,
        uint64 dueAt,
        Priority priority
    ) private returns (uint256 taskId) {
        if (externalId == bytes32(0)) revert InvalidExternalId();
        if (taskIdByExternalIdPlusOne[externalId] != 0) revert DuplicateExternalId();

        taskId = taskCount++;
        uint64 timestamp = uint64(block.timestamp);
        tasks[taskId] = Task({
            externalId: externalId,
            metadataHash: metadataHash,
            creator: msg.sender,
            assignee: assignee,
            createdAt: timestamp,
            updatedAt: timestamp,
            dueAt: dueAt,
            progress: 0,
            priority: priority,
            status: Status.Todo,
            deleted: false
        });
        taskIdByExternalIdPlusOne[externalId] = taskId + 1;
        _indexTaskForAssignee(assignee, taskId);

        emit TaskCreated(taskId, externalId, msg.sender, assignee, dueAt, priority, metadataHash);
    }

    function createSubTask(
        uint256 taskId,
        bytes32 externalId,
        bytes32 metadataHash
    ) external onlyAdmin taskExists(taskId) returns (uint256 subTaskId) {
        return _createSubTask(taskId, externalId, metadataHash);
    }

    function _createSubTask(
        uint256 taskId,
        bytes32 externalId,
        bytes32 metadataHash
    ) private returns (uint256 subTaskId) {
        if (externalId == bytes32(0)) revert InvalidExternalId();
        if (subTaskIdByExternalIdPlusOne[taskId][externalId] != 0) revert DuplicateSubTask();
        subTaskId = subTasks[taskId].length;
        uint64 timestamp = uint64(block.timestamp);
        subTasks[taskId].push(SubTask({
            externalId: externalId,
            metadataHash: metadataHash,
            createdAt: timestamp,
            updatedAt: timestamp,
            progress: 0,
            status: SubTaskStatus.Todo,
            deleted: false
        }));
        subTaskIdByExternalIdPlusOne[taskId][externalId] = subTaskId + 1;
        _recalculateProgressFromSubTasks(taskId, tasks[taskId]);
        emit SubTaskCreated(taskId, subTaskId, externalId, metadataHash);
    }

    function createChildTask(
        uint256 parentTaskId,
        bytes32 childExternalId,
        bytes32 childMetadataHash,
        address assignee,
        uint64 dueAt,
        Priority priority,
        bytes32 relationshipExternalId,
        bytes32 relationshipMetadataHash
    ) external onlyAdmin taskExists(parentTaskId) returns (uint256 childTaskId, uint256 subTaskId) {
        childTaskId = _createTask(childExternalId, childMetadataHash, assignee, dueAt, priority);
        subTaskId = _createSubTask(parentTaskId, relationshipExternalId, relationshipMetadataHash);
        childTaskIdBySubTaskPlusOne[parentTaskId][subTaskId] = childTaskId + 1;
    }

    function updateSubTaskMetadata(
        uint256 taskId,
        uint256 subTaskId,
        bytes32 metadataHash
    ) external onlyAdmin taskExists(taskId) {
        SubTask storage subTask = _getSubTask(taskId, subTaskId);
        subTask.metadataHash = metadataHash;
        subTask.updatedAt = uint64(block.timestamp);
    }

    function updateSubTaskStatus(
        uint256 taskId,
        uint256 subTaskId,
        SubTaskStatus status
    ) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        if (msg.sender != task.assignee && !admins[msg.sender]) revert Unauthorized();
        if (task.status == Status.Cancelled) revert InvalidStatusTransition();
        SubTask storage subTask = _getSubTask(taskId, subTaskId);
        subTask.status = status;
        if (status == SubTaskStatus.Todo || status == SubTaskStatus.Cancelled) subTask.progress = 0;
        else if (status == SubTaskStatus.Completed) subTask.progress = 100;
        else if (subTask.progress == 0) subTask.progress = 50;
        subTask.updatedAt = uint64(block.timestamp);
        _recalculateProgressFromSubTasks(taskId, task);
        emit SubTaskStatusUpdated(taskId, subTaskId, status, msg.sender);
        emit SubTaskProgressUpdated(taskId, subTaskId, subTask.progress, status, msg.sender);
    }

    function updateSubTaskProgress(
        uint256 taskId,
        uint256 subTaskId,
        uint8 progress
    ) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        if (msg.sender != task.assignee && !admins[msg.sender]) revert Unauthorized();
        if (task.status == Status.Cancelled) revert InvalidStatusTransition();
        if (progress > 100) revert InvalidProgress();
        SubTask storage subTask = _getSubTask(taskId, subTaskId);
        subTask.progress = progress;
        subTask.status = progress == 100
            ? SubTaskStatus.Completed
            : progress == 0
                ? SubTaskStatus.Todo
                : SubTaskStatus.InProgress;
        subTask.updatedAt = uint64(block.timestamp);
        _recalculateProgressFromSubTasks(taskId, task);
        emit SubTaskProgressUpdated(taskId, subTaskId, progress, subTask.status, msg.sender);
        emit SubTaskStatusUpdated(taskId, subTaskId, subTask.status, msg.sender);
    }

    function deleteSubTask(uint256 taskId, uint256 subTaskId) external onlyAdmin taskExists(taskId) {
        _deleteSubTask(taskId, subTaskId);
    }

    function _deleteSubTask(uint256 taskId, uint256 subTaskId) private {
        SubTask storage subTask = _getSubTask(taskId, subTaskId);
        subTask.deleted = true;
        subTask.updatedAt = uint64(block.timestamp);
        _recalculateProgressFromSubTasks(taskId, tasks[taskId]);
        emit SubTaskDeleted(taskId, subTaskId);
    }

    function updateTaskMetadata(uint256 taskId, bytes32 metadataHash) external onlyAdmin taskExists(taskId) {
        Task storage task = tasks[taskId];
        task.metadataHash = metadataHash;
        task.updatedAt = uint64(block.timestamp);
        emit TaskMetadataUpdated(taskId, metadataHash);
    }

    function assignTask(uint256 taskId, address assignee) external onlyAdmin taskExists(taskId) {
        Task storage task = tasks[taskId];
        address previousAssignee = task.assignee;
        task.assignee = assignee;
        _indexTaskForAssignee(assignee, taskId);
        task.updatedAt = uint64(block.timestamp);
        emit TaskAssigned(taskId, previousAssignee, assignee);
    }

    function updateSchedule(
        uint256 taskId,
        uint64 dueAt,
        Priority priority
    ) external onlyAdmin taskExists(taskId) {
        Task storage task = tasks[taskId];
        task.dueAt = dueAt;
        task.priority = priority;
        task.updatedAt = uint64(block.timestamp);
        emit TaskScheduleUpdated(taskId, dueAt, priority);
    }

    function updateProgress(uint256 taskId, uint8 progress) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        if (msg.sender != task.assignee && !admins[msg.sender]) revert Unauthorized();
        (uint256 activeCount,,) = _subTaskStats(taskId);
        if (activeCount != 0) revert InvalidProgress();
        _setProgress(taskId, task, progress);
    }

    function cancelTask(uint256 taskId) external onlyAdmin taskExists(taskId) {
        Task storage task = tasks[taskId];
        if (task.status == Status.Completed) revert InvalidStatusTransition();
        task.status = Status.Cancelled;
        task.updatedAt = uint64(block.timestamp);
        emit TaskProgressUpdated(taskId, task.progress, task.status, msg.sender);
    }

    function deleteTask(uint256 taskId) external onlyAdmin taskExists(taskId) {
        _deleteTask(taskId);
    }

    function _deleteTask(uint256 taskId) private {
        Task storage task = tasks[taskId];
        task.deleted = true;
        task.updatedAt = uint64(block.timestamp);
        emit TaskDeleted(taskId, msg.sender);
    }

    function deleteChildTask(
        uint256 childTaskId,
        uint256 parentTaskId,
        uint256 subTaskId
    ) external onlyAdmin taskExists(childTaskId) taskExists(parentTaskId) {
        if (childTaskIdBySubTaskPlusOne[parentTaskId][subTaskId] != childTaskId + 1) revert InvalidHierarchy();
        _deleteSubTask(parentTaskId, subTaskId);
        _deleteTask(childTaskId);
    }

    function submitDailyReport(
        uint256 taskId,
        uint8 progress,
        bytes32 workHash,
        bytes32 difficultyHash,
        bytes32 evidenceHash
    ) external taskExists(taskId) returns (uint256 reportId) {
        return _submitDailyReport(taskId, progress, workHash, difficultyHash, evidenceHash);
    }

    function _submitDailyReport(
        uint256 taskId,
        uint8 progress,
        bytes32 workHash,
        bytes32 difficultyHash,
        bytes32 evidenceHash
    ) private returns (uint256 reportId) {
        Task storage task = tasks[taskId];
        if (msg.sender != task.assignee && !admins[msg.sender]) revert Unauthorized();
        if (task.status == Status.Cancelled) revert InvalidStatusTransition();

        (uint256 activeCount,, uint8 calculatedProgress) = _subTaskStats(taskId);
        uint8 reportProgress = activeCount == 0 ? progress : calculatedProgress;
        if (activeCount != 0 && progress != calculatedProgress) revert InvalidProgress();
        _setProgress(taskId, task, reportProgress);
        reportId = reports[taskId].length;
        reports[taskId].push(
            DailyReport({
                reportedAt: uint64(block.timestamp),
                progress: reportProgress,
                workHash: workHash,
                difficultyHash: difficultyHash,
                evidenceHash: evidenceHash
            })
        );
        emit DailyReportSubmitted(
            taskId,
            reportId,
            msg.sender,
            reportProgress,
            workHash,
            difficultyHash,
            evidenceHash
        );
    }

    function submitDailyReportAndSyncAncestors(
        uint256 taskId,
        uint8 progress,
        bytes32 workHash,
        bytes32 difficultyHash,
        bytes32 evidenceHash,
        uint256[] calldata parentTaskIds,
        uint256[] calldata subTaskIds
    ) external taskExists(taskId) returns (uint256 reportId) {
        if (parentTaskIds.length != subTaskIds.length) revert InvalidHierarchy();
        reportId = _submitDailyReport(taskId, progress, workHash, difficultyHash, evidenceHash);
        uint256 childTaskId = taskId;
        uint8 childProgress = tasks[taskId].progress;
        for (uint256 i = 0; i < parentTaskIds.length; ++i) {
            uint256 parentTaskId = parentTaskIds[i];
            if (parentTaskId >= taskCount || tasks[parentTaskId].deleted) revert InvalidHierarchy();
            if (childTaskIdBySubTaskPlusOne[parentTaskId][subTaskIds[i]] != childTaskId + 1) {
                revert InvalidHierarchy();
            }
            SubTask storage subTask = _getSubTask(parentTaskId, subTaskIds[i]);
            subTask.progress = childProgress;
            subTask.status = childProgress == 100
                ? SubTaskStatus.Completed
                : childProgress == 0
                    ? SubTaskStatus.Todo
                    : SubTaskStatus.InProgress;
            subTask.updatedAt = uint64(block.timestamp);
            _recalculateProgressFromSubTasks(parentTaskId, tasks[parentTaskId]);
            emit SubTaskProgressUpdated(parentTaskId, subTaskIds[i], childProgress, subTask.status, msg.sender);
            emit SubTaskStatusUpdated(parentTaskId, subTaskIds[i], subTask.status, msg.sender);
            childTaskId = parentTaskId;
            childProgress = tasks[parentTaskId].progress;
        }
    }

    /// @notice Anchors a Plane comment, attachment, or evidence record without
    ///         publishing its private content on-chain.
    function recordTaskContent(
        uint256 taskId,
        ContentKind kind,
        bytes32 contentHash
    ) external taskExists(taskId) {
        Task storage task = tasks[taskId];
        if (msg.sender != task.assignee && !admins[msg.sender]) revert Unauthorized();
        if (contentHash == bytes32(0)) revert InvalidExternalId();
        contentRecords[taskId].push(ContentRecord({
            recordedBy: msg.sender,
            recordedAt: uint64(block.timestamp),
            kind: kind,
            contentHash: contentHash
        }));
        emit TaskContentRecorded(taskId, kind, contentHash, msg.sender);
    }

    function getTask(uint256 taskId) external view taskExists(taskId) returns (Task memory) {
        return tasks[taskId];
    }

    function getTaskId(bytes32 externalId) external view returns (uint256 taskId) {
        uint256 encodedId = taskIdByExternalIdPlusOne[externalId];
        if (encodedId == 0 || tasks[encodedId - 1].deleted) revert InvalidTask();
        return encodedId - 1;
    }

    function getSubTaskCount(uint256 taskId) external view taskExists(taskId) returns (uint256) {
        return subTasks[taskId].length;
    }

    function getSubTaskId(uint256 taskId, bytes32 externalId)
        external view taskExists(taskId) returns (uint256 subTaskId)
    {
        uint256 encodedId = subTaskIdByExternalIdPlusOne[taskId][externalId];
        if (encodedId == 0 || subTasks[taskId][encodedId - 1].deleted) revert InvalidSubTask();
        return encodedId - 1;
    }

    function getSubTask(uint256 taskId, uint256 subTaskId)
        external view taskExists(taskId) returns (SubTask memory)
    {
        return _getSubTask(taskId, subTaskId);
    }

    function getSubTasks(uint256 taskId, uint256 offset, uint256 limit)
        external view taskExists(taskId) returns (SubTask[] memory result)
    {
        uint256 length = subTasks[taskId].length;
        if (offset > length) revert InvalidSubTask();
        uint256 end = offset + limit < length ? offset + limit : length;
        result = new SubTask[](end - offset);
        for (uint256 i = offset; i < end; ++i) result[i - offset] = subTasks[taskId][i];
    }

    function getSubTaskStats(uint256 taskId)
        external view taskExists(taskId)
        returns (uint256 activeCount, uint256 completedCount, uint8 progress)
    {
        return _subTaskStats(taskId);
    }
    function getAssignedTaskCount(address assignee) external view returns (uint256) {
        uint256 count;
        uint256[] storage ids = assignedTaskIds[assignee];
        for (uint256 i = 0; i < ids.length; ++i) {
            Task storage task = tasks[ids[i]];
            if (!task.deleted && task.assignee == assignee) ++count;
        }
        return count;
    }

    /// @notice Returns a page of current tasks for an employee. Reassigned/deleted entries are skipped.
    function getAssignedTasks(address assignee, uint256 offset, uint256 limit)
        external view returns (Task[] memory result)
    {
        uint256[] storage ids = assignedTaskIds[assignee];
        if (offset > ids.length) revert InvalidTask();
        uint256 end = offset + limit < ids.length ? offset + limit : ids.length;
        uint256 count;
        for (uint256 i = offset; i < end; ++i) {
            Task storage task = tasks[ids[i]];
            if (!task.deleted && task.assignee == assignee) ++count;
        }
        result = new Task[](count);
        uint256 cursor;
        for (uint256 i = offset; i < end; ++i) {
            Task storage task = tasks[ids[i]];
            if (!task.deleted && task.assignee == assignee) result[cursor++] = task;
        }
    }

    function getContentCount(uint256 taskId) external view taskExists(taskId) returns (uint256) {
        return contentRecords[taskId].length;
    }

    function getTaskContent(uint256 taskId, uint256 contentId)
        external view taskExists(taskId) returns (ContentRecord memory)
    {
        if (contentId >= contentRecords[taskId].length) revert InvalidTask();
        return contentRecords[taskId][contentId];
    }
    function getReportCount(uint256 taskId) external view taskExists(taskId) returns (uint256) {
        return reports[taskId].length;
    }

    function getDailyReport(
        uint256 taskId,
        uint256 reportId
    ) external view taskExists(taskId) returns (DailyReport memory) {
        if (reportId >= reports[taskId].length) revert InvalidTask();
        return reports[taskId][reportId];
    }

    function getScheduleStatus(uint256 taskId) public view taskExists(taskId) returns (ScheduleStatus) {
        return _scheduleStatus(tasks[taskId]);
    }

    function isOverdue(uint256 taskId) public view taskExists(taskId) returns (bool) {
        return _scheduleStatus(tasks[taskId]) == ScheduleStatus.Overdue;
    }

    /// @notice Computes employee KPI. Call as eth_call; it does not spend gas.
    function getKPI(address assignee) external view returns (KPI memory result) {
        for (uint256 taskId = 0; taskId < taskCount; ++taskId) {
            Task storage task = tasks[taskId];
            if (task.deleted || task.assignee != assignee) continue;
            ++result.total;
            result.progressSum += task.progress;
            if (task.status == Status.Todo) ++result.todo;
            else if (task.status == Status.Completed) ++result.completed;
            else if (task.status == Status.InProgress) ++result.inProgress;
            else ++result.cancelled;

            ScheduleStatus schedule = _scheduleStatus(task);
            if (schedule == ScheduleStatus.OnSchedule) ++result.onSchedule;
            else if (schedule == ScheduleStatus.Delayed) ++result.delayed;
            else if (schedule == ScheduleStatus.Overdue) ++result.overdue;
        }
        if (result.total != 0) result.averageProgress = result.progressSum / result.total;
    }

    function _getSubTask(uint256 taskId, uint256 subTaskId) private view returns (SubTask storage subTask) {
        if (subTaskId >= subTasks[taskId].length || subTasks[taskId][subTaskId].deleted) revert InvalidSubTask();
        return subTasks[taskId][subTaskId];
    }

    function _subTaskStats(uint256 taskId)
        private view returns (uint256 activeCount, uint256 completedCount, uint8 progress)
    {
        SubTask[] storage items = subTasks[taskId];
        uint256 progressSum;
        for (uint256 i = 0; i < items.length; ++i) {
            SubTask storage subTask = items[i];
            if (subTask.deleted || subTask.status == SubTaskStatus.Cancelled) continue;
            ++activeCount;
            if (subTask.status == SubTaskStatus.Completed) ++completedCount;
            progressSum += subTask.progress;
        }
        if (activeCount != 0) progress = uint8(progressSum / activeCount);
    }

    function _recalculateProgressFromSubTasks(uint256 taskId, Task storage task) private {
        (, , uint8 progress) = _subTaskStats(taskId);
        _setProgress(taskId, task, progress);
    }
    function _scheduleStatus(Task storage task) private view returns (ScheduleStatus) {
        if (task.status == Status.Completed) return ScheduleStatus.Completed;
        if (task.status == Status.Cancelled) return ScheduleStatus.Cancelled;
        if (task.dueAt == 0) return ScheduleStatus.Unscheduled;
        if (block.timestamp > task.dueAt) return ScheduleStatus.Overdue;
        if (block.timestamp <= task.createdAt) return ScheduleStatus.OnSchedule;
        uint256 duration = uint256(task.dueAt) - task.createdAt;
        if (duration == 0) return ScheduleStatus.OnSchedule;
        uint256 expectedProgress = ((block.timestamp - task.createdAt) * 100) / duration;
        return task.progress < expectedProgress ? ScheduleStatus.Delayed : ScheduleStatus.OnSchedule;
    }

    function _setProgress(uint256 taskId, Task storage task, uint8 progress) private {
        if (progress > 100) revert InvalidProgress();
        if (task.status == Status.Cancelled) revert InvalidStatusTransition();

        task.progress = progress;
        task.status = progress == 100 ? Status.Completed : progress == 0 ? Status.Todo : Status.InProgress;
        task.updatedAt = uint64(block.timestamp);
        emit TaskProgressUpdated(taskId, progress, task.status, msg.sender);
    }

    function _indexTaskForAssignee(address assignee, uint256 taskId) private {
        if (assignee == address(0) || taskIndexedForAssignee[assignee][taskId]) return;
        taskIndexedForAssignee[assignee][taskId] = true;
        assignedTaskIds[assignee].push(taskId);
    }
}
