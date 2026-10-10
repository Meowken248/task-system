import type { RouteResult } from "./types";
import { hashPassword, getStoredCredentials, setStoredCredential, createUserObject } from "./auth";
import {
  localDB,
  saveDB,
  getContractGas,
  getDefaultWorkspaceSlug,
  getLoggedInUserId,
  getLoggedInEmail,
  isLoggedIn,
  setLoggedInUser,
  syncCrossPortWorkspaces,
  getInstanceInfo,
  getUserProfile,
  getUserSettings,
  getUserWorkspaces,
  getStoredInvitations,
  saveStoredInvitations,
  removeStoredInvitation,
} from "./store";
import {
  uploadToIPFS,
  fetchFromIPFS,
  applyOffchainDB,
  directRpcRead,
  decodeAbiWorkspace,
  abiEncodeGetWorkspace,
  baseCID,
  currentUserAddress,
  getStoredWalletAddress,
  getFiaiSDK,
  getWorkspaceRegistryAddress,
  WORKSPACE_REGISTRY_ADDRESS,
  CREATE_WORKSPACE_ABI,
  ADD_MEMBER_ABI,
  REMOVE_MEMBER_ABI,
  mapPlaneRoleToContractRole,
  extractEthAddress,
  syncDAppRecord,
  getLastUploadedCID,
  joinWorkspaceOnChain,
} from "./chain";

export { ok, parseApiUrl };

let lastLoadedPublicCid: string | null = null;

export async function handleRoute(method: string, url: string, body: Record<string, any>): Promise<RouteResult> {
  console.log(`[Dapp interceptor] INTERCEPTED ${method.toUpperCase()} ${url}`);
  syncCrossPortWorkspaces();
  const activeUserId = getLoggedInUserId();
  const loggedInEmail = typeof window !== "undefined" ? localStorage.getItem("plane_dapp_auth_email") : null;
  let activeUser = (localDB.users || []).find((u: any) =>
    (activeUserId && u.id === activeUserId) ||
    (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase()) ||
    (currentUserAddress && (
      u.id?.toLowerCase() === currentUserAddress.toLowerCase() ||
      u.email?.toLowerCase().startsWith(currentUserAddress.toLowerCase()) ||
      u.username?.toLowerCase() === currentUserAddress.toLowerCase()
    ))
  );
  if (!activeUser && activeUserId && loggedInEmail) {
    activeUser = createUserObject(activeUserId, loggedInEmail);
    if (!localDB.users) localDB.users = [];
    localDB.users.push(activeUser);
    saveDB();
  }
  if (!activeUser && (localDB.users || []).length === 1 && !loggedInEmail && !currentUserAddress) {
    activeUser = localDB.users[0];
  }

  // ── Workspace Slug Check (used by web:3000 and god-mode:3001) ───────
  if (url.includes("/api/workspace-slug-check") || url.includes("/api/instances/workspace-slug-check")) {
    const qsMatch = url.match(/[?&]slug=([^&]+)/);
    const slug = qsMatch ? decodeURIComponent(qsMatch[1]) : "";
    const exists = (localDB.workspaces || []).some((w: any) => w.slug?.toLowerCase() === slug.toLowerCase());
    return ok({ status: !exists });
  }

  // ── Workspace Sidebar Preferences ─────────────────────────────────
  if (url.includes("/sidebar-preferences")) {
    const slugMatch = url.match(/\/workspaces\/([^/]+)\/sidebar-preferences/);
    const slug = slugMatch ? slugMatch[1] : "";
    if (!localDB.sidebarPreferences) localDB.sidebarPreferences = {};
    const defaultPrefs: Record<string, any> = {
      views: { key: "views", is_pinned: true, sort_order: 1 },
      analytics: { key: "analytics", is_pinned: true, sort_order: 2 },
      archives: { key: "archives", is_pinned: true, sort_order: 3 },
    };
    if (method.toUpperCase() === "GET") {
      return ok(localDB.sidebarPreferences[slug] || defaultPrefs);
    }
    if (method.toUpperCase() === "PATCH") {
      if (!localDB.sidebarPreferences[slug]) {
        localDB.sidebarPreferences[slug] = { ...defaultPrefs };
      }
      if (Array.isArray(body)) {
        body.forEach((item: any) => {
          if (item && item.key) {
            localDB.sidebarPreferences[slug][item.key] = item;
          }
        });
      } else if (body && typeof body === "object") {
        Object.assign(localDB.sidebarPreferences[slug], body);
      }
      saveDB();
      return ok(localDB.sidebarPreferences[slug]);
    }
    return ok(defaultPrefs);
  }

  // ── Workspace Analytics Endpoints ─────────────────────────────────
  if (url.includes("/advance-analytics-charts")) {
    const slugMatch = url.match(/\/workspaces\/([^/?]+)/);
    const slug = slugMatch ? slugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === slug || w.id === slug);
    const wsKeys = new Set([slug, ws?.id, ws?.slug].filter(Boolean));
    const wsProjects = (localDB.projects || []).filter((p: any) => wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id));
    const wsProjectIds = new Set(wsProjects.map((p: any) => p.id));
    const wsIssues = (localDB.issues || []).filter((i: any) => wsProjectIds.has(i.project || i.project_id) && !(localDB._deleted_issue_ids || []).includes(i.id) && !i.is_draft);

    const typeMatch = url.match(/[?&]type=([^&]+)/);
    const chartType = typeMatch ? decodeURIComponent(typeMatch[1]) : "projects";

    if (chartType === "projects") {
      const chartData = wsProjects.map((p: any) => {
        const count = wsIssues.filter((i: any) => (i.project || i.project_id) === p.id).length;
        return {
          key: p.id,
          name: p.name || "Untitled Project",
          count,
        };
      });
      return ok(chartData);
    }

    if (chartType === "work-items") {
      const createdMap: Record<string, number> = {};
      const resolvedMap: Record<string, number> = {};
      wsIssues.forEach((i: any) => {
        const cDate = (i.created_at || i.created_on || "").split("T")[0];
        if (cDate) createdMap[cDate] = (createdMap[cDate] || 0) + 1;
        if (i.completed_at) {
          const rDate = i.completed_at.split("T")[0];
          if (rDate) resolvedMap[rDate] = (resolvedMap[rDate] || 0) + 1;
        }
      });
      const allDates = Array.from(new Set([...Object.keys(createdMap), ...Object.keys(resolvedMap)])).sort();
      const data = allDates.map((date) => ({
        key: date,
        name: date,
        count: (createdMap[date] || 0) + (resolvedMap[date] || 0),
        created: createdMap[date] || 0,
        resolved: resolvedMap[date] || 0,
      }));
      return ok({
        schema: { created: "Created", resolved: "Resolved" },
        data,
      });
    }

    // custom-work-items
    const priorityCounts: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0, none: 0 };
    wsIssues.forEach((i: any) => {
      const prio = (i.priority || "none").toLowerCase();
      if (prio in priorityCounts) priorityCounts[prio]++;
      else priorityCounts["none"]++;
    });
    const data = Object.entries(priorityCounts).map(([key, count]) => ({
      key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      count,
    }));
    return ok({
      schema: { count: "Count" },
      data,
    });
  }

  if (url.includes("/advance-analytics-stats")) {
    const slugMatch = url.match(/\/workspaces\/([^/?]+)/);
    const slug = slugMatch ? slugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === slug || w.id === slug);
    const wsKeys = new Set([slug, ws?.id, ws?.slug].filter(Boolean));
    const wsProjects = (localDB.projects || []).filter((p: any) => wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id));
    const wsProjectIds = new Set(wsProjects.map((p: any) => p.id));
    const wsIssues = (localDB.issues || []).filter((i: any) => wsProjectIds.has(i.project || i.project_id) && !(localDB._deleted_issue_ids || []).includes(i.id) && !i.is_draft);

    const states = localDB.states || [];
    const stateGroupMap = new Map(states.map((s: any) => [s.id, s.group]));
    const stats = wsProjects.map((p: any) => {
      const pIssues = wsIssues.filter((i: any) => (i.project || i.project_id) === p.id);
      let backlog = 0, started = 0, unstarted = 0, completed = 0, cancelled = 0;
      pIssues.forEach((i: any) => {
        const group = stateGroupMap.get(i.state_id || i.state) || i.state_detail?.group || "backlog";
        if (group === "backlog") backlog++;
        else if (group === "started") started++;
        else if (group === "unstarted") unstarted++;
        else if (group === "completed") completed++;
        else if (group === "cancelled") cancelled++;
        else unstarted++;
      });
      return {
        project_id: p.id,
        project__name: p.name || "Untitled Project",
        backlog_work_items: backlog,
        started_work_items: started,
        un_started_work_items: unstarted,
        completed_work_items: completed,
        cancelled_work_items: cancelled,
      };
    });
    return ok(stats);
  }

  if (url.includes("/project-stats")) {
    const slugMatch = url.match(/\/workspaces\/([^/?]+)/);
    const slug = slugMatch ? slugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === slug || w.id === slug);
    const wsKeys = new Set([slug, ws?.id, ws?.slug].filter(Boolean));
    const wsProjects = (localDB.projects || []).filter((p: any) => wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id));
    const wsProjectIds = new Set(wsProjects.map((p: any) => p.id));
    const wsIssues = (localDB.issues || []).filter((i: any) => wsProjectIds.has(i.project || i.project_id) && !(localDB._deleted_issue_ids || []).includes(i.id) && !i.is_draft);

    const states = localDB.states || [];
    const completedStateIds = new Set(states.filter((s: any) => s.group === "completed").map((s: any) => s.id));
    const projectStats = wsProjects.map((p: any) => {
      const pIssues = wsIssues.filter((i: any) => (i.project || i.project_id) === p.id);
      const completed_issues = pIssues.filter((i: any) => completedStateIds.has(i.state_id || i.state) || i.completed_at).length;
      return {
        id: p.id,
        total_issues: pIssues.length,
        completed_issues,
      };
    });
    return ok(projectStats);
  }

  if (url.includes("/advance-analytics")) {
    const slugMatch = url.match(/\/workspaces\/([^/?]+)/);
    const slug = slugMatch ? slugMatch[1] : "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === slug || w.id === slug);
    const wsKeys = new Set([slug, ws?.id, ws?.slug].filter(Boolean));
    const wsProjects = (localDB.projects || []).filter((p: any) => wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id));
    const wsProjectIds = new Set(wsProjects.map((p: any) => p.id));
    const wsIssues = (localDB.issues || []).filter((i: any) => wsProjectIds.has(i.project || i.project_id) && !(localDB._deleted_issue_ids || []).includes(i.id) && !i.is_draft);

    const wsMembers = (localDB.workspace_members || []).filter((m: any) => wsKeys.has(m.workspace) || wsKeys.has(m.workspace_id));
    const total_users = Math.max(wsMembers.length, (localDB.users || []).length, 1);
    const total_admins = Math.max(wsMembers.filter((m: any) => m.role === 20 || m.role === "admin").length, 1);
    const total_members = wsMembers.filter((m: any) => m.role === 15 || m.role === "member").length;
    const total_guests = wsMembers.filter((m: any) => m.role === 5 || m.role === "guest").length;
    const total_projects = wsProjects.length;
    const total_work_items = wsIssues.length;

    const states = localDB.states || [];
    const stateGroupMap = new Map(states.map((s: any) => [s.id, s.group]));
    let started_work_items = 0, backlog_work_items = 0, un_started_work_items = 0, completed_work_items = 0;
    wsIssues.forEach((i: any) => {
      const group = stateGroupMap.get(i.state_id || i.state) || i.state_detail?.group || "unstarted";
      if (group === "started") started_work_items++;
      else if (group === "backlog") backlog_work_items++;
      else if (group === "completed") completed_work_items++;
      else un_started_work_items++;
    });
    const total_cycles = (localDB.cycles || []).filter((c: any) => wsProjectIds.has(c.project || c.project_id)).length;
    const total_intake = (localDB.intakes || []).filter((it: any) => wsProjectIds.has(it.project || it.project_id)).length;

    return ok({
      total_users: { count: total_users, filter_count: total_users },
      total_admins: { count: total_admins, filter_count: total_admins },
      total_members: { count: total_members, filter_count: total_members },
      total_guests: { count: total_guests, filter_count: total_guests },
      total_projects: { count: total_projects, filter_count: total_projects },
      total_work_items: { count: total_work_items, filter_count: total_work_items },
      total_cycles: { count: total_cycles, filter_count: total_cycles },
      total_intake: { count: total_intake, filter_count: total_intake },
      started_work_items: { count: started_work_items, filter_count: started_work_items },
      backlog_work_items: { count: backlog_work_items, filter_count: backlog_work_items },
      un_started_work_items: { count: un_started_work_items, filter_count: un_started_work_items },
      completed_work_items: { count: completed_work_items, filter_count: completed_work_items },
    });
  }

  // ── Public Anchor API (Space App / Published Project) ─────────────────
  if (url.includes("/api/public/anchor/") || url.includes("/api/public/workspaces/")) {
    const anchorMatch = url.match(/\/api\/public\/anchor\/([^/?]+)(?:\/([^/?]+))?/);
    const pubWsMatch = url.match(/\/api\/public\/workspaces\/([^/]+)\/projects\/([^/]+)\/anchor/);

    if (!localDB["project-deploy-boards"]) localDB["project-deploy-boards"] = [];

    // Helper to fetch and load DB from IPFS when board is not in memory (zero localStorage dependency)
    const ensureBoardFromIPFS = async (predicate: (b: any) => boolean, requestedAnchor?: string): Promise<any> => {
      let cidToFetch: string | null = null;
      if (typeof window !== "undefined") {
        try {
          const searchParams = new URLSearchParams(window.location.search);
          cidToFetch = searchParams.get("cid");
        } catch { }
        if (!cidToFetch && typeof document !== "undefined") {
          const cookies = document.cookie ? document.cookie.split(";") : [];
          const cidCookie = cookies.find((row) => row.trim().startsWith("plane_dapp_sync_cid="));
          if (cidCookie) {
            const raw = cidCookie.trim().substring(cidCookie.trim().indexOf("=") + 1);
            cidToFetch = decodeURIComponent(raw || "").trim();
          }
        }
      }
      if (!cidToFetch) {
        try {
          const urlSearchParams = new URL(url, "http://localhost").searchParams;
          cidToFetch = urlSearchParams.get("cid");
        } catch { }
      }
      if ((!cidToFetch || cidToFetch.startsWith("bafkrei")) && WORKSPACE_REGISTRY_ADDRESS) {
        try {
          const wsInfoCalldata = abiEncodeGetWorkspace("fiai");
          const wsInfoRaw = await directRpcRead(WORKSPACE_REGISTRY_ADDRESS, wsInfoCalldata, 3000);
          const wsInfo = decodeAbiWorkspace(wsInfoRaw);
          if (wsInfo?.ipfsCID && wsInfo.ipfsCID.trim() !== "" && !wsInfo.ipfsCID.startsWith("bafkrei")) {
            cidToFetch = wsInfo.ipfsCID.trim();
          }
        } catch { }
      }

      // If a CID is specified and hasn't been applied yet, ALWAYS fetch and apply it from IPFS
      if (cidToFetch && cidToFetch !== lastLoadedPublicCid) {
        console.log(`[Public Anchor API] Đang tải trực tiếp DB từ IPFS CID: ${cidToFetch}...`);
        try {
          const ipfsDB = await fetchFromIPFS(cidToFetch);
          if (ipfsDB) {
            applyOffchainDB(ipfsDB);
            lastLoadedPublicCid = cidToFetch;
          }
        } catch (e) {
          console.warn("[Public Anchor API] Lỗi tải từ IPFS:", e);
        }
      }

      let b = (localDB["project-deploy-boards"] as any[]).find(predicate);
      if (b) {
        if (requestedAnchor && !b.anchor) b.anchor = requestedAnchor;
        return b;
      }

      // Fallback matching
      if (!b && (localDB["project-deploy-boards"] || []).length > 0) {
        const found = localDB["project-deploy-boards"][0];
        b = { ...found };
        if (requestedAnchor) {
          b.anchor = requestedAnchor;
          b.id = "board-" + requestedAnchor;
        }
        return b;
      }
      if (!b) {
        const targetProj = localDB.projects?.[0] || { id: "project-fiai", identifier: "FIAI", name: "FIAI" };
        const targetWs = localDB.workspaces?.[0] || { id: "workspace-fiai", slug: "fiai", name: "FIAI" };
        const defaultAnchor = requestedAnchor || crypto.randomUUID?.().replace(/-/g, "") || "48c26b7724a243d6a9a7a93a19b5bfb4";
        b = {
          id: "board-" + defaultAnchor,
          anchor: defaultAnchor,
          project: targetProj.id,
          project_id: targetProj.id,
          workspace: targetWs.id,
          workspace_id: targetWs.id,
          entity_name: "project",
          entity_identifier: targetProj.identifier,
          view_props: { list: true, kanban: true },
          is_comments_enabled: true,
          is_reactions_enabled: true,
          is_votes_enabled: true,
          project_details: targetProj,
          workspace_detail: targetWs,
        };
        localDB["project-deploy-boards"].push(b);
      }
      if (b && requestedAnchor) {
        b.anchor = requestedAnchor;
      }
      return b;
    };

    // GET /api/public/workspaces/:slug/projects/:projectId/anchor/
    if (pubWsMatch) {
      const _wsSlug = pubWsMatch[1];
      const projId = pubWsMatch[2];
      const board = await ensureBoardFromIPFS(
        (b: any) => b.project === projId || b.project_id === projId
      );
      if (board) return ok(board);
      return { data: { detail: "Not found" }, status: 404 };
    }

    if (anchorMatch) {
      const anchorId = anchorMatch[1];
      const subResource = anchorMatch[2] || "";

      // Find the deploy board by anchor (loading directly from IPFS if needed)
      let board = await ensureBoardFromIPFS((b: any) => b.anchor === anchorId || b.id === anchorId, anchorId);
      if (!board) {
        board = (localDB["project-deploy-boards"] || [])[0];
      }

      if (!board) {
        return { data: { detail: "Published project not found" }, status: 404 };
      }

      const projId = board.project || board.project_id;
      const project = (localDB.projects || []).find((p: any) => p.id === projId || p.identifier === projId) || localDB.projects?.[0];
      const ws = (localDB.workspaces || []).find(
        (w: any) => w.id === (board.workspace || board.workspace_id) || w.slug === (board.workspace || board.workspace_id)
      ) || localDB.workspaces?.[0];

      const projectIds = new Set(
        [
          projId,
          String(projId),
          project?.id,
          project?.id ? String(project.id) : null,
          project?.identifier,
          board.project,
          board.project ? String(board.project) : null,
          board.project_id,
          board.project_id ? String(board.project_id) : null,
          board.entity_identifier,
        ].filter(Boolean)
      );

      // GET /api/public/anchor/:anchor/meta/
      if (subResource === "meta") {
        return ok({
          name: project?.name || "Published Project",
          description: project?.description || "",
          cover_image: project?.cover_image || null,
        });
      }

      // GET /api/public/anchor/:anchor/settings/
      if (subResource === "settings") {
        return ok({
          ...board,
          anchor: anchorId,
          workspace: board.workspace || ws?.id,
          workspace_detail: board.workspace_detail || (ws ? { id: ws.id, name: ws.name, slug: ws.slug } : undefined),
          project_details: board.project_details || (project ? {
            id: project.id,
            name: project.name,
            identifier: project.identifier,
            cover_image: project.cover_image,
            description: project.description,
            logo_props: project.logo_props || { in_use: "icon", icon: { name: "folder", color: "#3f3f46" } },
          } : undefined),
        });
      }

      // GET /api/public/anchor/:anchor/states/
      if (subResource === "states") {
        let states = (localDB.states || []).filter(
          (s: any) => projectIds.has(s.project) || projectIds.has(s.project_id) || projectIds.has(String(s.project)) || projectIds.has(String(s.project_id))
        );
        if (states.length === 0) {
          states = [
            { id: "state-backlog", name: "Backlog", color: "#A3A3A3", sequence: 15000, group: "backlog", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-todo", name: "Todo", color: "#3A3A3A", sequence: 25000, group: "unstarted", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-in-progress", name: "In Progress", color: "#F59E0B", sequence: 35000, group: "started", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-done", name: "Done", color: "#16A34A", sequence: 45000, group: "completed", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-cancelled", name: "Cancelled", color: "#EF4444", sequence: 55000, group: "cancelled", project: project?.id || projId, project_id: project?.id || projId },
          ];
          if (!localDB.states) localDB.states = [];
          localDB.states.push(...states);
        }
        return ok(states);
      }

      // GET /api/public/anchor/:anchor/labels/
      if (subResource === "labels") {
        let labels = (localDB.labels || []).filter(
          (l: any) => projectIds.has(l.project) || projectIds.has(l.project_id) || projectIds.has(String(l.project)) || projectIds.has(String(l.project_id))
        );
        if (labels.length === 0 && (localDB.labels || []).length > 0) {
          labels = localDB.labels;
        }
        return ok(labels);
      }

      // GET /api/public/anchor/:anchor/members/
      if (subResource === "members") {
        const wsId = ws?.id || board.workspace;
        const members = (localDB.members || []).filter(
          (m: any) => m.workspace === wsId || m.workspace_id === wsId
        );
        return ok(members.map((m: any) => ({
          ...m,
          member: (localDB.users || []).find((u: any) => u.id === (m.member || m.member_id)) || m,
        })));
      }

      // GET /api/public/anchor/:anchor/modules/
      if (subResource === "modules") {
        const modules = (localDB.modules || []).filter(
          (m: any) => projectIds.has(m.project) || projectIds.has(m.project_id)
        );
        return ok(modules);
      }

      // GET /api/public/anchor/:anchor/cycles/
      if (subResource === "cycles") {
        const cycles = (localDB.cycles || []).filter(
          (c: any) => projectIds.has(c.project) || projectIds.has(c.project_id)
        );
        return ok(cycles);
      }

      // GET /api/public/anchor/:anchor/issues/ or /issues/:issueId/
      if (subResource === "issues") {
        const issueIdMatch = url.match(/\/issues\/([a-f0-9-]{36})\/?/);

        if (issueIdMatch) {
          // Single issue detail
          const issueId = issueIdMatch[1];
          const issue = (localDB.issues || []).find((i: any) => i.id === issueId || String(i.id) === issueId);
          if (issue) return ok(issue);
          return { data: { detail: "Issue not found" }, status: 404 };
        }

        // Issue list with pagination support
        let allIssues = (localDB.issues || []).filter(
          (i: any) => projectIds.has(i.project) || projectIds.has(i.project_id) || projectIds.has(String(i.project)) || projectIds.has(String(i.project_id))
        );

        if (allIssues.length === 0 && (localDB.issues || []).length > 0) {
          allIssues = localDB.issues;
        }

        // Parse query params for grouping / pagination
        const qsParams = new URLSearchParams(url.split("?")[1] || "");
        const groupBy = qsParams.get("group_by") || null;
        const perPage = parseInt(qsParams.get("per_page") || "50", 10);
        const _cursor = qsParams.get("cursor") || `${perPage}:0:0`;

        // Resolve project states
        let projectStates = (localDB.states || []).filter(
          (s: any) => projectIds.has(s.project) || projectIds.has(s.project_id) || projectIds.has(String(s.project)) || projectIds.has(String(s.project_id))
        );
        if (projectStates.length === 0) {
          projectStates = [
            { id: "state-backlog", name: "Backlog", color: "#A3A3A3", sequence: 15000, group: "backlog", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-todo", name: "Todo", color: "#3A3A3A", sequence: 25000, group: "unstarted", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-in-progress", name: "In Progress", color: "#F59E0B", sequence: 35000, group: "started", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-done", name: "Done", color: "#16A34A", sequence: 45000, group: "completed", project: project?.id || projId, project_id: project?.id || projId },
            { id: "state-cancelled", name: "Cancelled", color: "#EF4444", sequence: 55000, group: "cancelled", project: project?.id || projId, project_id: project?.id || projId },
          ];
          if (!localDB.states) localDB.states = [];
          localDB.states.push(...projectStates);
        }

        const backlogState = projectStates.find((s: any) => s.group === "backlog") || projectStates[0];
        const unstartedState = projectStates.find((s: any) => s.group === "unstarted") || projectStates[1] || backlogState;
        const startedState = projectStates.find((s: any) => s.group === "started") || projectStates[2] || backlogState;
        const completedState = projectStates.find((s: any) => s.group === "completed") || projectStates[3] || backlogState;
        const cancelledState = projectStates.find((s: any) => s.group === "cancelled") || projectStates[4] || backlogState;

        // Add state / created_at backfill and ensure valid state_id matching projectStates
        const enrichedIssues = allIssues.map((issue: any, idx: number) => {
          let matchedState = projectStates.find(
            (s: any) => s.id === issue.state_id || s.id === issue.state || String(s.id) === String(issue.state_id) || String(s.id) === String(issue.state)
          );

          if (!matchedState) {
            const rawState = String(issue.state_id || issue.state || "").toLowerCase();
            if (rawState === "1" || rawState.includes("backlog")) matchedState = backlogState;
            else if (rawState === "2" || rawState.includes("todo") || rawState.includes("unstart")) matchedState = unstartedState;
            else if (rawState === "3" || rawState.includes("progress") || rawState.includes("start")) matchedState = startedState;
            else if (rawState === "4" || rawState.includes("done") || rawState.includes("complete")) matchedState = completedState;
            else if (rawState === "5" || rawState.includes("cancel")) matchedState = cancelledState;
            else matchedState = backlogState;
          }

          const rawLabels = issue.labels || issue.label_ids || [];
          const labelIds = (Array.isArray(rawLabels) ? rawLabels : [rawLabels])
            .map((l: any) => (typeof l === "object" && l ? l.id : l))
            .filter(Boolean);

          const targetStateId = matchedState.id;
          const stateDetail = {
            id: matchedState.id,
            name: matchedState.name,
            color: matchedState.color,
            group: matchedState.group,
            sequence: matchedState.sequence,
          };

          return {
            ...issue,
            sequence_id: issue.sequence_id || idx + 1,
            state: targetStateId,
            state_id: targetStateId,
            state_detail: stateDetail,
            priority: (issue.priority || "none").toLowerCase(),
            labels: labelIds,
            label_ids: labelIds,
            project_id: project?.id || projId,
            workspace_id: ws?.id || "workspace-fiai",
            created_at: issue.created_at || issue.created_on || new Date().toISOString(),
            updated_at: issue.updated_at || issue.updated_on || issue.created_at || new Date().toISOString(),
          };
        });

        if (groupBy) {
          const grouped: Record<string, any[]> = {};
          if (groupBy === "state") {
            projectStates.forEach((s: any) => {
              grouped[s.id] = [];
            });
          }
          enrichedIssues.forEach((item: any) => {
            let key = "None";
            if (groupBy === "state") {
              key = item.state_id || item.state;
              if (!grouped[key]) {
                if (projectStates[0]) key = projectStates[0].id;
              }
            } else if (groupBy === "state_detail.group") {
              key = item.state_detail?.group || "backlog";
            } else if (groupBy === "target_date") {
              key = item.target_date ? item.target_date.split("T")[0] : "None";
            } else {
              key = item[groupBy] || "None";
            }
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
          });

          const result: Record<string, any> = {};
          for (const [key, items] of Object.entries(grouped)) {
            result[key] = {
              results: items,
              total_results: items.length,
              next_cursor: null,
              prev_cursor: null,
              next_page_results: false,
              total_pages: 1,
            };
          }
          return ok({
            results: result,
            grouped_by: groupBy,
            total_count: enrichedIssues.length,
            count: enrichedIssues.length,
            total_results: enrichedIssues.length,
            total_pages: 1,
            next_cursor: null,
            prev_cursor: null,
            next_page_results: false,
            prev_page_results: false,
          });
        }

        // Ungrouped
        return ok({
          results: enrichedIssues,
          total_count: enrichedIssues.length,
          count: enrichedIssues.length,
          total_results: enrichedIssues.length,
          next_cursor: null,
          prev_cursor: null,
          next_page_results: false,
          total_pages: 1,
        });
      }

      // Fallback: return the board settings for any unhandled sub-resource
      return ok(board);
    }
  }

  // ── Project Deploy Boards (Publish Project) ───────────────────────────
  if (url.includes("/project-deploy-boards")) {
    const match = url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/project-deploy-boards(?:\/([^/?]+))?/);
    const wsSlug = match ? match[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    const projId = match ? match[2] : "";
    const publishId = match ? match[3] : "";

    if (!localDB["project-deploy-boards"]) localDB["project-deploy-boards"] = [];

    // Ensure any previously saved board has an anchor
    (localDB["project-deploy-boards"] as any[]).forEach((b: any) => {
      if (!b.anchor) {
        b.anchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
      }
      if (!b.project && projId) b.project = projId;
      if (!b.project_id && projId) b.project_id = projId;
    });

    const methodUpper = method.toUpperCase();

    if (methodUpper === "GET") {
      let board: any = null;
      if (publishId) {
        board = localDB["project-deploy-boards"].find((b: any) => b.id === publishId);
      } else {
        board = localDB["project-deploy-boards"].find(
          (b: any) => b.project === projId || b.project_id === projId
        );
      }

      if (board) {
        if (!board.anchor) {
          board.anchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
          saveDB();
        }
        if (!board.cid) {
          board.cid = getLastUploadedCID() || undefined;
        }
        return ok(board);
      }
      return ok({});
    }

    if (methodUpper === "POST") {
      let board = localDB["project-deploy-boards"].find(
        (b: any) => b.project === projId || b.project_id === projId
      );
      const project = (localDB.projects || []).find((p: any) => p.id === projId || p.identifier === projId);
      const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

      if (!board) {
        const newAnchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
        board = {
          id: body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          anchor: newAnchor,
          project: projId,
          project_id: projId,
          workspace: ws?.id || wsSlug,
          workspace_id: ws?.id || wsSlug,
          entity_name: "project",
          entity_identifier: project?.identifier || projId,
          is_comments_enabled: !!body.is_comments_enabled,
          is_reactions_enabled: !!body.is_reactions_enabled,
          is_votes_enabled: !!body.is_votes_enabled,
          view_props: body.view_props || { list: true, kanban: true },
          project_details: project
            ? {
              id: project.id,
              name: project.name,
              identifier: project.identifier,
              cover_image: project.cover_image,
              description: project.description,
              logo_props: project.logo_props,
            }
            : undefined,
          workspace_detail: ws
            ? {
              id: ws.id,
              name: ws.name,
              slug: ws.slug,
            }
            : undefined,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: activeUserId || "user-1",
          updated_by: activeUserId || "user-1",
          inbox: null,
        };
        localDB["project-deploy-boards"].push(board);
      } else {
        if (!board.anchor) {
          board.anchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
        }
        board.is_comments_enabled = !!body.is_comments_enabled;
        board.is_reactions_enabled = !!body.is_reactions_enabled;
        board.is_votes_enabled = !!body.is_votes_enabled;
        if (body.view_props) board.view_props = body.view_props;
        board.updated_at = new Date().toISOString();
      }

      if (project) {
        project.anchor = board.anchor;
      }

      saveDB();

      // Trigger immediate IPFS upload so the published board is pinned to IPFS
      try {
        const newCid = await uploadToIPFS(true);
        if (newCid) {
          board.cid = newCid;
          saveDB();
        }
      } catch (uploadErr) {
        console.warn("[Project Deploy Boards] Lỗi upload IPFS:", uploadErr);
      }

      return { data: board, status: 201 };
    }

    if (methodUpper === "PATCH" || methodUpper === "PUT") {
      let board = localDB["project-deploy-boards"].find(
        (b: any) => b.id === publishId || b.project === projId || b.project_id === projId
      );
      if (board) {
        Object.assign(board, body, { updated_at: new Date().toISOString() });
        if (!board.anchor) {
          board.anchor = crypto.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2, 18);
        }
        const project = (localDB.projects || []).find((p: any) => p.id === projId || p.identifier === projId);
        if (project) project.anchor = board.anchor;
        saveDB();

        try {
          const newCid = await uploadToIPFS(true);
          if (newCid) {
            board.cid = newCid;
            saveDB();
          }
        } catch { }

        return ok(board);
      }
      return ok(body);
    }

    if (methodUpper === "DELETE") {
      localDB["project-deploy-boards"] = (localDB["project-deploy-boards"] || []).filter(
        (b: any) => b.id !== publishId && b.project !== projId && b.project_id !== projId
      );
      const project = (localDB.projects || []).find((p: any) => p.id === projId || p.identifier === projId);
      if (project) {
        project.anchor = null;
      }
      saveDB();
      try {
        await uploadToIPFS(true);
      } catch { }
      return ok({ message: "Project unpublished successfully" });
    }
  }

  // ── Auth endpoints ──────────────────────────────────────────────────
  if (url.includes("/auth/get-csrf-token")) return ok({ csrf_token: "dapp-csrf-token" });

  if (url.includes("/auth/email-check")) {
    const email = (body?.email || "").trim().toLowerCase();
    const creds = getStoredCredentials();
    let existing = (localDB.users || []).some((u: any) => (u.email || "").toLowerCase() === email);
    if (!existing && creds[email]) {
      existing = true;
      if (!localDB.users) localDB.users = [];
      localDB.users.push(createUserObject(`user-${Date.now()}`, email, undefined, undefined, creds[email]));
    }
    if (!existing && typeof window !== "undefined") {
      try {
        const rawLocal = localStorage.getItem("plane_dapp_local_db");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          const cachedUser = (parsed?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
          if (cachedUser) {
            existing = true;
            if (!localDB.users) localDB.users = [];
            localDB.users.push(cachedUser);
            if (cachedUser.password_hash) {
              setStoredCredential(email, cachedUser.password_hash);
            }
          }
        }
      } catch { }
    }
    return ok({ existing, is_password_autoset: false, status: "CREDENTIAL" });
  }

  if (url.includes("/auth/sign-in") || url.includes("/auth/magic-sign-in")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const password = body?.password || "";
    const creds = getStoredCredentials();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);

    // Fallback: If not in localDB yet, check cached local DB snapshot
    if (!user && typeof window !== "undefined") {
      try {
        const rawLocal = localStorage.getItem("plane_dapp_local_db");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          const cachedUser = (parsed?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
          if (cachedUser) {
            user = cachedUser;
            if (!localDB.users) localDB.users = [];
            localDB.users.push(cachedUser);
          }
        }
      } catch { }
    }

    const storedHash = user?.password_hash || creds[email];

    if (!user && !storedHash) {
      return { data: { error: "Tài khoản không tồn tại. Vui lòng đăng ký trước." }, status: 404 };
    }

    // Strict password verification
    if (!storedHash) {
      return { data: { error: "Tài khoản chưa thiết lập mật khẩu. Vui lòng sử dụng tính năng quên mật khẩu hoặc đăng ký lại." }, status: 400 };
    }

    if (!password) {
      return { data: { error: "Vui lòng nhập mật khẩu." }, status: 400 };
    }

    const inputHash = await hashPassword(password);
    if (inputHash !== storedHash) {
      return { data: { error: "Mật khẩu không chính xác. Vui lòng thử lại." }, status: 401 };
    }
    if (user) user.password_hash = storedHash;

    if (!user) {
      const isFirstUser = !localDB.users || localDB.users.length === 0;
      user = createUserObject(`user-${Date.now()}`, email, undefined, undefined, storedHash, isFirstUser);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
      saveDB();
    }

    // Validate user's workspace access
    const myWorkspaces = getUserWorkspaces(user.id, user.email);
    const validCurrentWs = myWorkspaces.find((w: any) => w.slug === user.last_workspace_slug || w.id === user.last_workspace_id);
    if (!validCurrentWs) {
      user.last_workspace_slug = myWorkspaces[0]?.slug || null;
      user.last_workspace_id = myWorkspaces[0]?.id || null;
      user.is_onboarded = myWorkspaces.length > 0;
      saveDB();
    }

    setLoggedInUser(user.id);
    if (typeof window !== "undefined") {
      localStorage.setItem("plane_dapp_auth_email", user.email);
      if (user.last_workspace_slug) {
        localStorage.setItem("last_workspace_slug", user.last_workspace_slug);
        document.cookie = `last_workspace_slug=${user.last_workspace_slug}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.removeItem("last_workspace_slug");
        localStorage.removeItem("last_workspace_id");
        document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
      }
    }
    return ok({ ...user, access_token: "dapp-token", refresh_token: "dapp-refresh" });
  }

  if (url.includes("/auth/sign-up")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const password = body?.password || "";
    const creds = getStoredCredentials();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);

    if (!user && typeof window !== "undefined") {
      try {
        const rawLocal = localStorage.getItem("plane_dapp_local_db");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          const cachedUser = (parsed?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
          if (cachedUser) {
            user = cachedUser;
          }
        }
      } catch { }
    }

    const storedHash = user?.password_hash || creds[email];

    // Chặn tuyệt đối việc đăng ký đè lên tài khoản đã tồn tại
    if (storedHash || user) {
      return { data: { error: "Email này đã được đăng ký. Vui lòng đăng nhập." }, status: 400 };
    }

    const passwordHash = password ? await hashPassword(password) : undefined;
    if (passwordHash) {
      setStoredCredential(email, passwordHash);
    }
    const isFirstUser = !localDB.users || localDB.users.length === 0;
    user = createUserObject(`user-${Date.now()}`, email, body?.first_name, body?.last_name, passwordHash, isFirstUser);
    if (!localDB.users) localDB.users = [];
    localDB.users.push(user);
    saveDB();
    setLoggedInUser(user.id);
    if (typeof window !== "undefined") {
      localStorage.setItem("plane_dapp_auth_email", user.email);
      if (user.last_workspace_slug) {
        localStorage.setItem("last_workspace_slug", user.last_workspace_slug);
        document.cookie = `last_workspace_slug=${user.last_workspace_slug}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.removeItem("last_workspace_slug");
        localStorage.removeItem("last_workspace_id");
        document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
      }
    }

    // Kích hoạt upload IPFS ngay lập tức và đợi tối đa 3 giây để đảm bảo tài khoản đã lên IPFS trước khi chuyển trang
    try {
      await Promise.race([
        uploadToIPFS(true),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch (e) {
      console.warn("[DApp DB] Upload IPFS lúc đăng ký có lỗi:", e);
    }

    return ok({ ...user, access_token: "dapp-token", refresh_token: "dapp-refresh" });
  }

  if (url.includes("/auth/forgot-password") || url.includes("/auth/set-password")) {
    const newPwd = body?.password || body?.new_password || "";
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email) || activeUser;
    if (newPwd && email) {
      const newHash = await hashPassword(newPwd);
      setStoredCredential(email, newHash);
      if (user) user.password_hash = newHash;
      saveDB();
      try {
        await Promise.race([
          uploadToIPFS(true),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch { }
      return ok({ message: "Password updated successfully" });
    }
    return { data: { error: "Invalid password or email" }, status: 400 };
  }

  if (url.includes("/auth/sign-out")) {
    setLoggedInUser(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("plane_dapp_auth_email");
      localStorage.removeItem("last_workspace_slug");
      localStorage.removeItem("last_workspace_id");
      document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
    }
    return ok({ message: "success" });
  }

  // ── Instance ────────────────────────────────────────────────────────
  if (url.match(/\/api\/instances\/?$/) || url.match(/\/api\/instances\/\?/)) {
    if (method === "patch" || method === "put" || method === "post") {
      if (!localDB.instance) localDB.instance = {};
      Object.assign(localDB.instance, body);
      saveDB();
    }
    return ok(getInstanceInfo());
  }

  if (url.includes("/api/instances/configurations")) return ok([]);

  if (url.includes("/api/instances/workspaces") && method === "get")
    return ok({ results: localDB.workspaces || [], next_cursor: null, prev_cursor: null, total_count: (localDB.workspaces || []).length });

  // ── Admin Auth & Management Endpoints ────────────────────────────────
  if (url.includes("/api/instances/admins/sign-out")) {
    setLoggedInUser(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("plane_dapp_auth_email");
      localStorage.removeItem("last_workspace_slug");
      localStorage.removeItem("last_workspace_id");
      document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
    }
    return ok({ message: "success" });
  }

  if (url.includes("/api/instances/admins/sign-in")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const password = body?.password || "";
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);
    const creds = getStoredCredentials();
    const storedHash = user?.password_hash || creds[email];

    if (!user && !storedHash) {
      return { data: { error: "Tài khoản quản trị viên không tồn tại. Vui lòng đăng ký trước." }, status: 404 };
    }

    if (!storedHash) {
      return { data: { error: "Tài khoản quản trị viên chưa thiết lập mật khẩu. Vui lòng đăng ký trước." }, status: 400 };
    }

    if (!password) {
      return { data: { error: "Vui lòng nhập mật khẩu." }, status: 400 };
    }
    const inputHash = await hashPassword(password);
    if (inputHash !== storedHash) {
      return { data: { error: "Mật khẩu quản trị viên không chính xác." }, status: 401 };
    }
    if (user) user.password_hash = storedHash;

    if (!user) {
      user = createUserObject(`admin-${Date.now()}`, email, undefined, undefined, storedHash);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
      saveDB();
    }

    setLoggedInUser(user.id);
    if (typeof window !== "undefined") localStorage.setItem("plane_dapp_auth_email", user.email);
    return ok(user);
  }

  if (url.includes("/api/instances/admins/sign-up")) {
    const email = (body?.email || loggedInEmail || "").trim().toLowerCase();
    const password = body?.password || "";
    const creds = getStoredCredentials();
    let user = (localDB.users || []).find((u: any) => u.email?.toLowerCase() === email);
    if (user && (user.password_hash || creds[email])) {
      return { data: { error: "Email này đã được đăng ký quản trị viên. Vui lòng đăng nhập." }, status: 400 };
    }
    const passwordHash = password ? await hashPassword(password) : undefined;
    if (passwordHash && email) {
      setStoredCredential(email, passwordHash);
    }

    if (user) {
      if (passwordHash) user.password_hash = passwordHash;
      user.first_name = body?.first_name || user.first_name;
      user.last_name = body?.last_name || user.last_name;
      user.display_name = `${user.first_name} ${user.last_name}`.trim();
    } else {
      user = createUserObject(`admin-${Date.now()}`, email, body?.first_name, body?.last_name, passwordHash);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
    }
    const companyName = body?.company_name || body?.company || body?.instance_name;
    if (companyName) {
      if (!localDB.instance) localDB.instance = {};
      localDB.instance.instance_name = companyName;
    }
    if (!localDB.instance) localDB.instance = {};
    if (!localDB.instance.id || localDB.instance.id === "dapp-instance") {
      localDB.instance.id = `instance-${Date.now().toString(36)}`;
      localDB.instance.instance_id = localDB.instance.id;
    }
    localDB.instance.is_setup_done = true;
    saveDB();
    setLoggedInUser(user.id);
    if (typeof window !== "undefined") localStorage.setItem("plane_dapp_auth_email", user.email);
    return ok(user);
  }

  if (url.includes("/api/instances/admins/me")) {
    if (!isLoggedIn() || !activeUser) {
      return { data: { error: "not authenticated" }, status: 401 };
    }
    if (method === "patch" || method === "put" || method === "post") {
      Object.assign(activeUser, body);
      saveDB();
    }
    return ok(activeUser);
  }

  if (url.match(/\/api\/instances\/admins\/?$/) || url.match(/\/api\/instances\/admins\/\?/)) {
    let users = localDB.users || [];
    if (users.length === 0 && (loggedInEmail || activeUserId)) {
      const fallbackUser = createUserObject(activeUserId || `admin-${Date.now().toString(36)}`, loggedInEmail || "");
      users = [fallbackUser];
    }
    const adminList = users.map((u: any) => ({
      id: `admin-${u.id}`,
      instance: localDB.instance?.instance_id || "instance-main",
      role: "admin",
      user: u.id,
      user_detail: {
        id: u.id,
        first_name: u.first_name || "",
        last_name: u.last_name || "",
        email: u.email || loggedInEmail || "",
        display_name: u.display_name || u.email || loggedInEmail || "",
        avatar_url: u.avatar_url || "",
      },
      created_at: u.date_joined || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    return ok(adminList);
  }

  // ── Workspace Creation (both web /api/workspaces/ and admin /api/instances/workspaces/) ──
  if (
    (url.match(/\/api\/workspaces\/?$/) || url.match(/\/api\/instances\/workspaces\/?$/)) &&
    method === "post"
  ) {
    const wsId = body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
    const slug = body.slug || body.name?.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || `ws-${Date.now()}`;
    const newWorkspace = {
      id: wsId,
      name: body.name || "My Workspace",
      slug: slug,
      organization_size: body.organization_size || "1-10",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: activeUser?.id || "admin",
      owner: {
        id: activeUser?.id || "admin",
        email: activeUser?.email || loggedInEmail || "",
        first_name: activeUser?.first_name || "Admin",
        last_name: activeUser?.last_name || "",
        avatar: activeUser?.avatar_url || "",
      },
      role: 20,
      ...body,
    };

    if (localDB._deleted_workspace_ids) {
      localDB._deleted_workspace_ids = localDB._deleted_workspace_ids.filter((dId: string) => dId !== wsId);
    }
    if (localDB._deleted_workspace_slugs) {
      localDB._deleted_workspace_slugs = localDB._deleted_workspace_slugs.filter((s: string) => s !== slug);
    }

    if (!localDB.workspaces) localDB.workspaces = [];
    const existingIdx = localDB.workspaces.findIndex((w: any) => w.id === wsId || w.slug === slug);
    if (existingIdx >= 0) {
      localDB.workspaces[existingIdx] = { ...localDB.workspaces[existingIdx], ...newWorkspace };
    } else {
      localDB.workspaces.push(newWorkspace);
    }

    if (!localDB.workspace_members) localDB.workspace_members = [];
    localDB.workspace_members.push({
      id: `ws-member-${Date.now()}`,
      workspace: wsId,
      workspace_id: wsId,
      member: activeUser?.id || "me",
      role: 20,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    if (activeUser) {
      activeUser.last_workspace_id = wsId;
      activeUser.last_workspace_slug = slug;
      activeUser.is_onboarded = true;
      if (!activeUser.onboarding_step) activeUser.onboarding_step = {};
      activeUser.onboarding_step.workspace_create = true;
      activeUser.onboarding_step.profile_complete = true;
      activeUser.onboarding_step.workspace_join = true;
      activeUser.onboarding_step.workspace_invite = true;
    }

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("last_workspace_slug", slug);
        document.cookie = `last_workspace_slug=${slug}; path=/; max-age=31536000; SameSite=Lax`;
        document.cookie = `plane_dapp_sync_workspaces=${encodeURIComponent(JSON.stringify(localDB.workspaces))}; path=/; max-age=31536000; SameSite=Lax`;
      } catch (e) {
        console.warn("[DApp Workspace] Không thể lưu cookies:", e);
      }
    }

    // GỌI SMART CONTRACT: PlaneWorkspaceRegistry.createWorkspace
    const bridge = getFiaiSDK();
    const wsRegistryAddr = getWorkspaceRegistryAddress();
    if (wsRegistryAddr && bridge && currentUserAddress) {
      const initialCid = baseCID || "QmInitial";
      bridge
        .request("sendTransaction", {
          from: currentUserAddress,
          to: wsRegistryAddr,
          abiData: [CREATE_WORKSPACE_ABI],
          functionName: "createWorkspace",
          feeType: "sc",
          amount: "0",
          value: "0",
          gas: getContractGas(),
          type: "transaction",
          inputArray: [
            { name: "slug", type: "string", value: slug },
            { name: "name", type: "string", value: newWorkspace.name },
            { name: "initialCid", type: "string", value: initialCid },
          ],
          isReadOnly: false,
          bundleId: "",
        })
        .then(() => {
          console.log(`[DApp Workspace] ✅ Đã tạo workspace ${slug} on-chain trên PlaneWorkspaceRegistry`);
          return true;
        })
        .catch((err: any) => {
          console.warn(`[DApp Workspace] createWorkspace on-chain thất bại (có thể đã tồn tại):`, err);
        });
    }

    saveDB();
    return { data: newWorkspace, status: 201 };
  }

  // ── Workspace Deletion ────────────────────────────────────────────────
  const wsDeleteMatch = url.match(/\/api\/workspaces\/([^/]+)\/?$/);
  if (wsDeleteMatch && method === "delete") {
    const slugOrId = wsDeleteMatch[1];
    const targetWs = (localDB.workspaces || []).find((w: any) => w.id === slugOrId || w.slug === slugOrId);
    const targetId = targetWs?.id || slugOrId;
    const targetSlug = targetWs?.slug || slugOrId;

    if (!localDB._deleted_workspace_ids) localDB._deleted_workspace_ids = [];
    if (!localDB._deleted_workspace_ids.includes(targetId)) {
      localDB._deleted_workspace_ids.push(targetId);
    }
    if (!localDB._deleted_workspace_slugs) localDB._deleted_workspace_slugs = [];
    if (!localDB._deleted_workspace_slugs.includes(targetSlug)) {
      localDB._deleted_workspace_slugs.push(targetSlug);
    }

    const deletedWsIds = new Set(localDB._deleted_workspace_ids);
    const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs);

    // 1. Remove from localDB.workspaces
    localDB.workspaces = (localDB.workspaces || []).filter(
      (w: any) => w.id !== targetId && w.slug !== targetSlug && !deletedWsIds.has(w.id) && !deletedWsSlugs.has(w.slug)
    );

    // 2. Cascade delete all projects belonging to this workspace
    const deletedProjects = (localDB.projects || []).filter(
      (p: any) => p.workspace === targetId || p.workspace === targetSlug || p.workspace_id === targetId || p.workspace_id === targetSlug
    );
    if (!localDB._deleted_project_ids) localDB._deleted_project_ids = [];
    for (const dp of deletedProjects) {
      if (!localDB._deleted_project_ids.includes(dp.id)) localDB._deleted_project_ids.push(dp.id);
      if (dp.identifier && !localDB._deleted_project_ids.includes(dp.identifier)) localDB._deleted_project_ids.push(dp.identifier);
    }
    const currentDeletedProjSet = new Set(localDB._deleted_project_ids);
    localDB.projects = (localDB.projects || []).filter(
      (p: any) => p.workspace !== targetId && p.workspace !== targetSlug && p.workspace_id !== targetId && p.workspace_id !== targetSlug && !currentDeletedProjSet.has(p.id)
    );

    // 3. Cascade delete all issues for those projects or this workspace
    if (localDB.issues) {
      const deletedProjIds = new Set(deletedProjects.map((p: any) => p.id));
      const deletedIssues = localDB.issues.filter(
        (i: any) => deletedProjIds.has(i.project) || deletedProjIds.has(i.project_id) || i.workspace === targetId || i.workspace === targetSlug
      );
      if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
      for (const di of deletedIssues) {
        if (!localDB._deleted_issue_ids.includes(di.id)) localDB._deleted_issue_ids.push(di.id);
      }
      const currentDeletedIssueSet = new Set(localDB._deleted_issue_ids);
      localDB.issues = localDB.issues.filter(
        (i: any) => !deletedProjIds.has(i.project) && !deletedProjIds.has(i.project_id) && i.workspace !== targetId && i.workspace !== targetSlug && !currentDeletedIssueSet.has(i.id)
      );
    }

    // 4. Cascade delete states, labels, cycles, modules, workspace_members
    if (localDB.states) {
      localDB.states = localDB.states.filter((s: any) => s.workspace !== targetId && s.workspace !== targetSlug);
    }
    if (localDB.labels) {
      localDB.labels = localDB.labels.filter((l: any) => l.workspace !== targetId && l.workspace !== targetSlug);
    }
    if (localDB.cycles) {
      localDB.cycles = localDB.cycles.filter((c: any) => c.workspace !== targetId && c.workspace !== targetSlug);
    }
    if (localDB.modules) {
      localDB.modules = localDB.modules.filter((m: any) => m.workspace !== targetId && m.workspace !== targetSlug);
    }
    if (localDB.workspace_members) {
      localDB.workspace_members = localDB.workspace_members.filter(
        (m: any) => m.workspace !== targetId && m.workspace !== targetSlug && m.workspace_id !== targetId && m.workspace_id !== targetSlug
      );
    }

    // 5. Update activeUser
    const remainingWs = (localDB.workspaces && localDB.workspaces.length > 0) ? localDB.workspaces[0] : null;
    if (activeUser) {
      if (activeUser.last_workspace_slug === targetSlug || activeUser.last_workspace_id === targetId) {
        activeUser.last_workspace_slug = remainingWs ? remainingWs.slug : null;
        activeUser.last_workspace_id = remainingWs ? remainingWs.id : null;
      }
    }

    // 6. Update localStorage and document.cookie
    if (typeof window !== "undefined") {
      try {
        if (localStorage.getItem("last_workspace_slug") === targetSlug) {
          if (remainingWs) {
            localStorage.setItem("last_workspace_slug", remainingWs.slug);
          } else {
            localStorage.removeItem("last_workspace_slug");
          }
        }
        if (remainingWs) {
          document.cookie = `last_workspace_slug=${remainingWs.slug}; path=/; max-age=31536000; SameSite=Lax`;
        } else {
          document.cookie = `last_workspace_slug=; path=/; max-age=0; SameSite=Lax`;
        }
        document.cookie = `plane_dapp_sync_workspaces=${encodeURIComponent(JSON.stringify(localDB.workspaces))}; path=/; max-age=31536000; SameSite=Lax`;
      } catch (e) {
        console.warn("[DApp Workspace] Không thể cập nhật cookies:", e);
      }
    }

    saveDB();
    console.log(`[DApp Workspace] ✅ Đã xóa workspace ${targetSlug} (${targetId}), còn lại:`, localDB.workspaces);
    return ok({ message: "Workspace deleted successfully" });
  }

  if (url.match(/\/api\/users\/me/)) {
    if (!isLoggedIn()) return { data: { error: "not authenticated" }, status: 401 };

    if (url.includes("/api/users/me/profile")) {
      if (method === "patch" || method === "put" || method === "post") {
        if (!activeUser) {
          activeUser = (localDB.users || [])[0] || createUserObject(activeUserId || "user-default", loggedInEmail || "admin@plane.local");
          if (!localDB.users) localDB.users = [];
          if (!localDB.users.includes(activeUser)) localDB.users.push(activeUser);
        }
        if (body?.theme) {
          activeUser.theme = { ...(activeUser.theme || {}), ...body.theme };
          if (typeof window !== "undefined") {
            if (body.theme.theme) {
              localStorage.setItem("theme", body.theme.theme);
              localStorage.setItem("plane_user_theme", body.theme.theme);
            }
          }
        }
        Object.assign(activeUser, body);
        saveDB();
      }
      return ok(getUserProfile());
    }

    // Handle /api/users/me/onboard/ — marks user onboarding as complete
    if (url.includes("/api/users/me/onboard")) {
      if (activeUser) {
        activeUser.is_onboarded = true;
        if (!activeUser.onboarding_step) activeUser.onboarding_step = {};
        activeUser.onboarding_step.profile_complete = true;
        activeUser.onboarding_step.workspace_create = true;
        activeUser.onboarding_step.workspace_join = true;
        activeUser.onboarding_step.workspace_invite = true;
        saveDB();
      }
      return ok({ is_onboarded: true });
    }

    if (url.includes("/api/users/me/settings")) {
      if ((method === "patch" || method === "put" || method === "post") && body?.workspace) {
        if (body.workspace.last_workspace_slug && activeUser) {
          activeUser.last_workspace_slug = body.workspace.last_workspace_slug;
          if (typeof window !== "undefined") {
            localStorage.setItem("last_workspace_slug", body.workspace.last_workspace_slug);
            document.cookie = `last_workspace_slug=${body.workspace.last_workspace_slug}; path=/; max-age=31536000; SameSite=Lax`;
          }
        }
        if (body.workspace.last_workspace_id && activeUser) {
          activeUser.last_workspace_id = body.workspace.last_workspace_id;
        }
        saveDB();
      }
      return ok(getUserSettings());
    }

    if (url.includes("/api/users/me/instance-admin")) return ok({ is_instance_admin: true });

    if (url.includes("/api/users/me/accounts")) return ok([]);

    if (url.includes("/api/users/me/activities")) {
      const activities = localDB.issue_activities || [];
      return ok({
        count: activities.length,
        extra_stats: null,
        next_cursor: "",
        next_page_results: false,
        prev_cursor: "",
        prev_page_results: false,
        results: activities,
        total_pages: 1,
        total_results: activities.length,
      });
    }

    if (url.includes("/api/users/me/notification-preferences")) {
      return ok({
        property_change: true,
        state_change: true,
        comment: true,
        mention: true,
        issue_completed: true,
      });
    }

    if (url.includes("/project-roles")) return ok({}); // return empty object for project roles

    if (url.includes("/api/users/me/workspaces") && !url.includes("/project-roles") && !url.includes("/invitations")) {
      syncCrossPortWorkspaces();
      const activeId = activeUser?.id || activeUserId;
      const activeMail = (activeUser?.email || loggedInEmail || "").toLowerCase().trim();
      const myWorkspaces = getUserWorkspaces(activeId, activeMail);
      const enriched = myWorkspaces.map((ws: any) => {
        const isOwner = ws.created_by === activeId || ws.owner?.id === activeId || (activeMail && ws.owner?.email?.toLowerCase() === activeMail);
        const memberRecord = (localDB.workspace_members || []).find(
          (m: any) =>
            (m.workspace === ws.slug || m.workspace === ws.id || m.workspace_id === ws.slug || m.workspace_id === ws.id) &&
            (m.member === activeId || m.id === activeId || (activeMail && m.email?.toLowerCase() === activeMail))
        );
        const resolvedRole = isOwner ? 20 : (memberRecord?.role || 15);
        return Object.assign({}, ws, { role: resolvedRole });
      });
      return ok(enriched);
    }

    if (url.includes("/api/users/me/workspaces/invitations") || url.includes("/api/users/me/invitations")) {
      if (method === "get") {
        syncCrossPortWorkspaces();
        const stored = getStoredInvitations();
        if (!localDB.invitations) localDB.invitations = [];
        for (const inv of stored) {
          if (!localDB.invitations.some((i: any) => i.id === inv.id)) {
            localDB.invitations.push(inv);
          }
        }
        saveStoredInvitations(localDB.invitations);

        const userEmail = (activeUser?.email || loggedInEmail || "").toLowerCase().trim();
        const userId = activeUser?.id || activeUserId;
        const allInvites = localDB.invitations || [];
        console.log(`[DApp Invitations] GET invitations — userEmail=${userEmail}, userId=${userId}, allInvites count=${allInvites.length}`);
        console.log(`[DApp Invitations] All invites:`, JSON.stringify(allInvites.map((i: any) => ({ id: i.id, email: i.email, accepted: i.accepted }))));
        const myInvites = allInvites.filter((inv: any) => {
          if (inv.accepted) return false;
          const inviteEmail = (inv.email || "").toLowerCase().trim();
          const match = (
            (userEmail && inviteEmail === userEmail) ||
            (userId && (inv.member === userId || inviteEmail === String(userId).toLowerCase().trim())) ||
            (currentUserAddress && inviteEmail === currentUserAddress.toLowerCase().trim())
          );
          console.log(`[DApp Invitations] Check inv ${inv.id}: inviteEmail=${inviteEmail}, match=${match}`);
          return match;
        });
        console.log(`[DApp Invitations] Returning ${myInvites.length} invites for ${userEmail}`);
        return ok(myInvites);
      }
      if (method === "post") {
        const acceptedIds: string[] = Array.isArray(body?.invitations) ? body.invitations : [];
        if (!localDB.invitations) localDB.invitations = [];
        if (!localDB.workspace_members) localDB.workspace_members = [];

        acceptedIds.forEach((invId: string) => {
          const inv = localDB.invitations.find((i: any) => i.id === invId);
          if (inv) {
            inv.accepted = true;
            inv.updated_at = new Date().toISOString();

            const wsSlug = inv.workspace?.slug || inv.workspace?.id || inv.workspace || inv.workspace_slug;
            const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
            const activeId = activeUser?.id || activeUserId || "user-default";
            const activeMail = (activeUser?.email || loggedInEmail || inv.email || "").toLowerCase().trim();

            // Mark ALL duplicate invitations for this email and workspace as accepted
            (localDB.invitations || []).forEach((otherInv: any) => {
              const otherWs = otherInv.workspace?.slug || otherInv.workspace?.id || otherInv.workspace || otherInv.workspace_slug;
              const otherMail = (otherInv.email || "").toLowerCase().trim();
              if (otherMail === activeMail && (otherWs === wsSlug || otherWs === ws?.id)) {
                otherInv.accepted = true;
                otherInv.responded_at = new Date().toISOString();
                otherInv.updated_at = new Date().toISOString();
              }
            });

            const existingIdx = localDB.workspace_members.findIndex(
              (m: any) =>
                (m.workspace === wsSlug || m.workspace_id === wsSlug || m.workspace === ws?.id) &&
                (m.member === activeId || (activeMail && m.email?.toLowerCase() === activeMail))
            );
            const memberRecord = {
              id: `ws-member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              workspace: ws?.id || wsSlug,
              workspace_id: ws?.id || wsSlug,
              member: activeId,
              email: activeMail,
              role: inv.role || 15,
              is_active: true,
              created_at: new Date().toISOString(),
            };
            if (existingIdx >= 0) {
              localDB.workspace_members[existingIdx] = { ...localDB.workspace_members[existingIdx], ...memberRecord };
            } else {
              localDB.workspace_members.push(memberRecord);
            }

            if (activeUser) {
              activeUser.last_workspace_id = ws?.id || wsSlug;
              activeUser.last_workspace_slug = ws?.slug || wsSlug;
              activeUser.is_onboarded = true;
              if (!activeUser.onboarding_step) activeUser.onboarding_step = {};
              activeUser.onboarding_step.workspace_join = true;
              activeUser.onboarding_step.profile_complete = true;
              activeUser.onboarding_step.workspace_invite = true;
            }
            if (typeof window !== "undefined") {
              localStorage.setItem("last_workspace_slug", ws?.slug || wsSlug);
              document.cookie = `last_workspace_slug=${ws?.slug || wsSlug}; path=/; max-age=31536000; SameSite=Lax`;
            }

            if (wsSlug) {
              void joinWorkspaceOnChain(wsSlug);
            }
          }
        });

        saveStoredInvitations(localDB.invitations);
        saveDB();
        void uploadToIPFS(true);
        return ok({ message: "Invitations accepted successfully" });
      }
    }

    if (method === "patch" || method === "put" || method === "post") {
      if (!activeUser) {
        activeUser =
          (localDB.users || [])[0] ||
          createUserObject(activeUserId || "user-default", loggedInEmail || "admin@plane.local");
        if (!localDB.users) localDB.users = [];
        if (!localDB.users.includes(activeUser)) localDB.users.push(activeUser);
      }
      Object.assign(activeUser, body);
      saveDB();
    }
    return ok(activeUser);
  }

  // ── Workspace Invitation Join / Retrieve ─────────────────────────────
  const wsInvJoinMatch = url.match(/\/api\/workspaces\/([^/]+)\/invitations\/([^/]+)\/join\/?(?:\?.*)?$/);
  if (wsInvJoinMatch) {
    const wsSlug = wsInvJoinMatch[1];
    const invitationId = wsInvJoinMatch[2];
    const inv = (localDB.invitations || []).find((i: any) => i.id === invitationId);
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

    if (method === "get") {
      if (!inv) {
        return { data: { error: "Invitation not found" }, status: 404 };
      }
      return ok({
        id: inv.id,
        email: inv.email,
        role: inv.role || 15,
        token: inv.token || inv.id,
        responded_at: inv.responded_at || null,
        workspace: {
          id: ws?.id || wsSlug,
          name: ws?.name || wsSlug,
          slug: ws?.slug || wsSlug,
          logo_url: ws?.logo_url || "",
        },
      });
    }

    if (method === "post") {
      if (!inv) {
        return { data: { error: "Invitation not found" }, status: 404 };
      }
      const isAccepted = body?.accepted === true || body?.accepted === "true";
      inv.responded_at = new Date().toISOString();
      inv.accepted = isAccepted;
      inv.updated_at = new Date().toISOString();

      if (isAccepted) {
        const activeId = activeUser?.id || activeUserId || "user-default";
        const activeMail = (activeUser?.email || loggedInEmail || inv.email || "").toLowerCase().trim();

        // Mark ALL duplicate invitations for this email and workspace as accepted (with prefix match)
        (localDB.invitations || []).forEach((otherInv: any) => {
          const otherWs = otherInv.workspace?.slug || otherInv.workspace?.id || otherInv.workspace || otherInv.workspace_slug;
          const otherMail = (otherInv.email || "").toLowerCase().trim();
          const isTargetWs = !otherWs || otherWs === wsSlug || otherWs === ws?.id;
          const mailMatched = otherMail === activeMail;
          if (mailMatched && isTargetWs) {
            otherInv.accepted = true;
            otherInv.responded_at = new Date().toISOString();
            otherInv.updated_at = new Date().toISOString();
          }
        });

        if (!localDB.workspace_members) localDB.workspace_members = [];
        const existingIdx = localDB.workspace_members.findIndex(
          (m: any) =>
            (m.workspace === wsSlug || m.workspace_id === wsSlug || m.workspace === ws?.id) &&
            ((activeId && activeId !== "user-default" && m.member === activeId) || (activeMail && (m.email || "").toLowerCase().trim() === activeMail))
        );
        const resolvedMemberId = (activeId && activeId !== "user-default") ? activeId : (activeMail ? `user-${activeMail.split("@")[0]}` : `member-${Date.now()}`);
        const memberRecord = {
          id: `ws-member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          workspace: ws?.id || wsSlug,
          workspace_id: ws?.id || wsSlug,
          member: resolvedMemberId,
          email: activeMail,
          role: inv.role || 15,
          is_active: true,
          created_at: new Date().toISOString(),
        };
        if (existingIdx >= 0) {
          localDB.workspace_members[existingIdx] = { ...localDB.workspace_members[existingIdx], ...memberRecord };
        } else {
          localDB.workspace_members.push(memberRecord);
        }

        if (activeUser) {
          activeUser.last_workspace_id = ws?.id || wsSlug;
          activeUser.last_workspace_slug = ws?.slug || wsSlug;
          activeUser.is_onboarded = true;
          if (!activeUser.onboarding_step) activeUser.onboarding_step = {};
          activeUser.onboarding_step.workspace_join = true;
          activeUser.onboarding_step.profile_complete = true;
          activeUser.onboarding_step.workspace_invite = true;
        }
        if (typeof window !== "undefined") {
          localStorage.setItem("last_workspace_slug", ws?.slug || wsSlug);
          document.cookie = `last_workspace_slug=${ws?.slug || wsSlug}; path=/; max-age=31536000; SameSite=Lax`;
        }

        // Trigger on-chain joinWorkspace
        if (wsSlug) {
          void joinWorkspaceOnChain(wsSlug);
        }
      }

      saveDB();
      syncDAppRecord("invitations", inv.id, inv);
      void uploadToIPFS(true);
      return ok({ message: isAccepted ? "Workspace joined successfully" : "Invitation rejected" });
    }
  }

  // ── Projects & Workspace Members ────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/([^/]+)\/workspace-members\/me\/?/)) {
    const wsSlug = url.match(/\/api\/workspaces\/([^/]+)\/workspace-members\/me\/?/)?.[1] || "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    if (!ws) {
      return { data: { error: "Workspace not found" }, status: 404 };
    }

    const activeId = activeUser?.id || activeUserId || "user-default";
    const activeMail = (activeUser?.email || loggedInEmail || "").toLowerCase();

    // Check if user is owner / creator of workspace
    const isOwner =
      ws.created_by === activeId ||
      ws.owner?.id === activeId ||
      (activeMail && ws.owner?.email?.toLowerCase() === activeMail);

    // Check if user is in localDB.workspace_members
    const memberRecord = (localDB.workspace_members || []).find(
      (m: any) =>
        (m.workspace === wsSlug || m.workspace === ws.id || m.workspace_id === wsSlug || m.workspace_id === ws.id) &&
        (m.member === activeId ||
          m.id === activeId ||
          (activeMail && m.email?.toLowerCase() === activeMail) ||
          (currentUserAddress && m.member?.toLowerCase() === currentUserAddress.toLowerCase()))
    );

    if (isOwner) {
      return ok({
        id: "ws-member-me",
        member: activeId,
        role: ws.role || 20,
        workspace: ws.id || wsSlug,
        is_active: true,
        created_at: ws.created_at || new Date().toISOString(),
      });
    }

    if (memberRecord) {
      return ok({
        id: memberRecord.id || `ws-member-${activeId}`,
        member: activeId,
        role: memberRecord.role || 15,
        workspace: ws.id || wsSlug,
        is_active: memberRecord.is_active !== false,
        created_at: memberRecord.created_at || new Date().toISOString(),
      });
    }

    // Default workspace fallback: only if unowned and system has <= 1 user
    if ((!ws.created_by || ws.created_by === "user-default") && (localDB.users || []).length <= 1) {
      ws.created_by = activeId;
      return ok({
        id: "ws-member-me",
        member: activeId,
        role: 20,
        workspace: ws.id || wsSlug,
        is_active: true,
        created_at: new Date().toISOString(),
      });
    }

    return { data: { error: "You are not a member of this workspace" }, status: 403 };
  }

  // ── Workspace Integrations & Import / Export ────────────────────────
  if (url.includes("/api/integrations")) {
    return ok([
      {
        id: "github-integration",
        title: "GitHub",
        provider: "github",
        description: "Connect with GitHub with your Plane workspace to sync project work items.",
        author: "Plane",
        avatar_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        verified: true,
        webhook_secret: "",
        webhook_url: "",
        redirect_url: "",
        network: 1,
        metadata: {},
      },
      {
        id: "slack-integration",
        title: "Slack",
        provider: "slack",
        description: "Connect with Slack with your Plane workspace to sync project work items.",
        author: "Plane",
        avatar_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        verified: true,
        webhook_secret: "",
        webhook_url: "",
        redirect_url: "",
        network: 1,
        metadata: {},
      },
    ]);
  }

  if (url.includes("/workspace-integrations")) {
    return ok(localDB.workspace_integrations || []);
  }

  if (url.includes("/importers")) {
    return ok([]);
  }

  if (url.includes("/export-issues")) {
    const userDetail = {
      id: activeUser?.id || "user-default",
      display_name: activeUser?.display_name || activeUser?.first_name || "User",
      email: activeUser?.email || "",
      avatar_url: activeUser?.avatar_url || activeUser?.avatar || "",
    };
    if (method === "post") {
      const newExport = {
        id: "exp-" + Date.now(),
        provider: body?.provider || "csv",
        status: "completed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        url: "",
        token: "",
        created_by: userDetail.id,
        updated_by: userDetail.id,
        project: Array.isArray(body?.project) ? body.project : [],
        initiated_by_detail: userDetail,
      };
      if (!localDB.exports) localDB.exports = [];
      localDB.exports.unshift(newExport);
      saveDB();
      return ok(newExport);
    }
    const exports = (localDB.exports || []).map((exp: any) => ({
      ...exp,
      project: Array.isArray(exp?.project) ? exp.project : [],
      initiated_by_detail: exp?.initiated_by_detail || userDetail,
    }));
    return ok({
      count: exports.length,
      extra_stats: null,
      next_cursor: "",
      next_page_results: false,
      prev_cursor: "",
      prev_page_results: false,
      results: exports,
      total_pages: 1,
      total_results: exports.length,
    });
  }

  if (url.match(/\/api\/workspaces\/[^/]+\/members\/?(?:\?.*)?$/)) {
    const wsSlug = url.match(/\/api\/workspaces\/([^/]+)\/members\/?/)?.[1] || "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

    if (method === "get") {
      syncCrossPortWorkspaces();
      const membersList: any[] = [];
      const addedMemberKeys = new Set<string>();

      // 1. Workspace Owner / Creator
      const ownerId = ws?.created_by || ws?.owner?.id;
      const ownerEmail = (ws?.owner?.email || "").toLowerCase().trim();
      const ownerUser = (localDB.users || []).find(
        (u: any) => (ownerId && ownerId !== "user-default" && u.id === ownerId) || (ownerEmail && (u.email || "").toLowerCase().trim() === ownerEmail)
      ) || ws?.owner || {
        id: ownerId || "owner-default",
        email: ownerEmail,
        first_name: ws?.owner?.first_name || "Owner",
        last_name: ws?.owner?.last_name || "",
        display_name: ws?.owner?.display_name || ws?.owner?.first_name || "Owner",
        avatar_url: "",
        is_active: true,
      };

      const ownerKey = ownerUser.id || ownerId || "owner-default";
      membersList.push({
        id: `ws-member-${ownerKey}`,
        member: {
          id: ownerKey,
          email: ownerUser.email || ownerEmail,
          first_name: ownerUser.first_name || "Owner",
          last_name: ownerUser.last_name || "",
          display_name: ownerUser.display_name || ownerUser.first_name || "Owner",
          avatar_url: ownerUser.avatar_url || "",
          is_active: true,
        },
        role: 20,
        workspace: ws?.id || wsSlug,
        is_active: true,
        created_at: ws?.created_at || new Date().toISOString(),
      });
      if (ownerKey !== "user-default" && ownerKey !== "owner-default") {
        addedMemberKeys.add(ownerKey);
      }
      if (ownerEmail) addedMemberKeys.add(ownerEmail);

      // 2. Pending invites set (to avoid listing unaccepted invites as members)
      // 3. Accepted Workspace Members from localDB.workspace_members
      const workspaceMembers = (localDB.workspace_members || []).filter(
        (m: any) =>
          (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id)
      );

      // Auto-resolve any pending invites for confirmed active members (with alias/prefix support)
      const activeWsMemberMails = new Set(
        workspaceMembers.map((m: any) => (m.email || "").toLowerCase().trim()).filter(Boolean)
      );
      if (activeWsMemberMails.size > 0 && localDB.invitations && Array.isArray(localDB.invitations)) {
        let invChanged = false;
        localDB.invitations.forEach((inv: any) => {
          const invMail = (inv.email || "").toLowerCase().trim();
          const invWs = inv.workspace?.slug || inv.workspace?.id || inv.workspace || inv.workspace_slug;
          const isTargetWs = !invWs || invWs === wsSlug || invWs === ws?.id;
          if (invMail && isTargetWs) {
            let matched = activeWsMemberMails.has(invMail);
            if (!matched) {
              for (const actMail of Array.from(activeWsMemberMails)) {
                const actPrefix = String(actMail).split("@")[0];
                const invPrefix = invMail.split("@")[0];
                if ((actPrefix.length >= 6 && invPrefix.startsWith(actPrefix)) || (invPrefix.length >= 6 && actPrefix.startsWith(invPrefix))) {
                  matched = true;
                  break;
                }
              }
            }
            if (matched && !inv.accepted) {
              inv.accepted = true;
              invChanged = true;
            }
          }
        });
        if (invChanged) {
          saveStoredInvitations(localDB.invitations);
        }
      }

      workspaceMembers.forEach((wm: any) => {
        let memberKey = typeof wm.member === "string" ? wm.member : (wm.member?.id || wm.email || wm.id || "");
        const memberMail = (wm.email || (memberKey.includes("@") ? memberKey : "")).toLowerCase().trim();
        if (memberKey === "user-default" || !memberKey) {
          memberKey = memberMail ? `user-${memberMail.split("@")[0]}` : wm.id || `member-${Date.now()}`;
        }
        if ((memberMail && addedMemberKeys.has(memberMail)) || (memberKey !== "user-default" && addedMemberKeys.has(memberKey))) {
          return;
        }

        const user = (localDB.users || []).find(
          (u: any) => u.id === memberKey || (memberMail && (u.email || "").toLowerCase().trim() === memberMail) || u.username === memberKey
        );
        const isEth = memberKey.startsWith("0x");
        const shortAddr = isEth ? `${memberKey.slice(0, 6)}...${memberKey.slice(-4)}` : "Member";
        const namePart = memberMail.includes("@") ? memberMail.split("@")[0] : shortAddr;
        const memberObj = user || {
          id: memberKey || wm.id || `member-${namePart}`,
          email: wm.email || (isEth ? `${memberKey}@fiai.network` : memberKey),
          first_name: wm.first_name || namePart,
          last_name: wm.last_name || "",
          display_name: wm.display_name || wm.first_name || namePart,
          avatar_url: "",
          is_active: true,
        };

        membersList.push({
          id: wm.id || `ws-member-${memberObj.id}`,
          member: memberObj,
          role: wm.role || 15,
          workspace: ws?.id || wsSlug,
          is_active: wm.is_active !== false,
          created_at: wm.created_at || new Date().toISOString(),
        });
        if (memberObj.id && memberObj.id !== "user-default") addedMemberKeys.add(memberObj.id);
        if (memberObj.email) addedMemberKeys.add(memberObj.email.toLowerCase().trim());
      });

      // 4. Fallback for single-user initial installation
      const activeId = activeUser?.id || activeUserId;
      const activeMail = (activeUser?.email || loggedInEmail || "").toLowerCase().trim();
      if (activeId && !addedMemberKeys.has(activeId) && (!activeMail || !addedMemberKeys.has(activeMail))) {
        if ((!ws?.created_by || ws?.created_by === "user-default") && (!localDB.users || localDB.users.length <= 1)) {
          membersList.push({
            id: `ws-member-${activeId}`,
            member: activeUser || { id: activeId, email: activeMail, first_name: "User", last_name: "", display_name: "User" },
            role: 20,
            workspace: ws?.id || wsSlug,
            is_active: true,
            created_at: new Date().toISOString(),
          });
          addedMemberKeys.add(activeId);
        }
      }

      return ok(membersList);
    }
  }

  // ── Workspace Member Detail (DELETE, PATCH) ─────────────────────────
  const wsMemberDetailMatch = url.match(/\/api\/workspaces\/([^/]+)\/members\/([^/]+)\/?(?:\?.*)?$/);
  if (wsMemberDetailMatch) {
    const wsSlug = wsMemberDetailMatch[1];
    const memberId = wsMemberDetailMatch[2];

    if (method === "delete") {
      const target = (localDB.workspace_members || []).find((m: any) => m.id === memberId || m.member === memberId);
      if (localDB.workspace_members) {
        localDB.workspace_members = localDB.workspace_members.filter(
          (m: any) => m.id !== memberId && m.member !== memberId
        );
        saveDB();
      }

      const memberAddr = extractEthAddress(target?.address || target?.member || target?.email);
      const bridge = getFiaiSDK();
      const wsRegistryAddr = getWorkspaceRegistryAddress();
      if (memberAddr && wsRegistryAddr && bridge && currentUserAddress) {
        bridge
          .request("sendTransaction", {
            from: currentUserAddress,
            to: wsRegistryAddr,
            abiData: [REMOVE_MEMBER_ABI],
            functionName: "removeMember",
            feeType: "sc",
            amount: "0",
            value: "0",
            gas: getContractGas(),
            type: "transaction",
            inputArray: [
              { name: "slug", type: "string", value: wsSlug },
              { name: "member", type: "address", value: memberAddr },
            ],
            isReadOnly: false,
            bundleId: "",
          })
          .then(() => {
            console.log(`[DApp Interceptor] ✅ Đã xóa thành viên ${memberAddr} khỏi ${wsSlug} on-chain`);
            return true;
          })
          .catch((err: any) => {
            console.warn(`[DApp Interceptor] removeMember on-chain thất bại:`, err);
          });
      }

      return ok({ message: "Member removed" });
    }

    if (method === "patch" || method === "put") {
      let updatedMember: any = null;
      if (localDB.workspace_members) {
        const idx = localDB.workspace_members.findIndex((m: any) => m.id === memberId || m.member === memberId);
        if (idx >= 0) {
          localDB.workspace_members[idx] = { ...localDB.workspace_members[idx], ...body };
          updatedMember = localDB.workspace_members[idx];
          saveDB();
        }
      }

      if (updatedMember && body.role !== undefined) {
        const memberAddr = extractEthAddress(updatedMember.address || updatedMember.member || updatedMember.email);
        const bridge = getFiaiSDK();
        const wsRegistryAddr = getWorkspaceRegistryAddress();
        if (memberAddr && wsRegistryAddr && bridge && currentUserAddress) {
          const contractRole = mapPlaneRoleToContractRole(body.role);
          bridge
            .request("sendTransaction", {
              from: currentUserAddress,
              to: wsRegistryAddr,
              abiData: [ADD_MEMBER_ABI],
              functionName: "addMember",
              feeType: "sc",
              amount: "0",
              value: "0",
              gas: getContractGas(),
              type: "transaction",
              inputArray: [
                { name: "slug", type: "string", value: wsSlug },
                { name: "member", type: "address", value: memberAddr },
                { name: "role", type: "uint8", value: String(contractRole) },
              ],
              isReadOnly: false,
              bundleId: "",
            })
            .catch((err: any) => {
              console.warn(`[DApp Interceptor] Cập nhật role on-chain thất bại:`, err);
            });
        }
      }

      return ok(updatedMember || { id: memberId, ...body });
    }
  }

  if (
    method === "get" &&
    (url.match(/\/api\/workspaces\/[^/]+\/projects\/?(?:\?.*)?$/) || url.includes("/projects/details"))
  ) {
    const wsSlugMatch = url.match(/\/api\/workspaces\/([^/]+)\/projects/);
    const wsSlug = wsSlugMatch ? wsSlugMatch[1] : null;
    const ws = wsSlug ? (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug) : null;
    const canonicalWsId = ws?.id || wsSlug;
    const validWsKeys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));

    const currentUserId = activeUser?.id || activeUserId;
    const currentUserEmail = (activeUser?.email || loggedInEmail || "").toLowerCase().trim();

    // Check if user is Workspace Admin/Owner
    const wsMember = (localDB.workspace_members || []).find(
      (wm: any) =>
        (wm.workspace === ws?.id || wm.workspace === ws?.slug || wm.workspace === wsSlug) &&
        (wm.member === currentUserId || (currentUserEmail && (wm.email || "").toLowerCase().trim() === currentUserEmail))
    );
    const isWsAdmin =
      Boolean(ws && (ws.created_by === currentUserId || ws.owner?.id === currentUserId || (currentUserEmail && ws.owner?.email?.toLowerCase().trim() === currentUserEmail))) ||
      (currentUserEmail === "anh2482006@gmail.com") ||
      Boolean(wsMember && Number(wsMember.role) >= 20);

    const deletedSet = new Set(localDB._deleted_project_ids || []);
    const projects = (localDB.projects || [])
      .filter((p: any) => {
        if (deletedSet.has(p.id) || deletedSet.has(p.identifier)) return false;
        if (validWsKeys.size > 0) {
          const pWs = p.workspace || p.workspace_id || p.workspace_detail?.id || p.workspace_detail?.slug;
          if (pWs) return validWsKeys.has(pWs);
          return ws?.slug === getDefaultWorkspaceSlug();
        }
        return true;
      })
      .map((p: any, index: number) => {
        const pm = (localDB.project_members || []).find((pMember: any) => {
          const pId = pMember.project || pMember.project_id;
          const pMail = (pMember.email || "").toLowerCase().trim();
          const pMem = String(pMember.member || "");
          return (pId === p.id) && (
            (currentUserEmail && pMail === currentUserEmail) ||
            (currentUserId && currentUserId !== "user-default" && pMem === currentUserId)
          );
        });

        const isProjCreator = Boolean(
          (currentUserId && currentUserId !== "user-default" && (p.created_by === currentUserId || p.owner === currentUserId || p.owner?.id === currentUserId)) ||
          (currentUserEmail && (
            (p.created_by && p.created_by.toLowerCase().trim() === currentUserEmail) ||
            (p.owner?.email && p.owner.email.toLowerCase().trim() === currentUserEmail) ||
            (currentUserEmail === "anh2482006@gmail.com" && (!p.created_by || p.created_by === "user-default"))
          ))
        );

        let resolvedRole: number = 20;
        if (pm && pm.role) {
          resolvedRole = pm.role;
        } else if (isProjCreator || isWsAdmin) {
          resolvedRole = 20;
        } else if (p.member_role) {
          resolvedRole = p.member_role;
        }

        // Calculate next_work_item_sequence from actual issues
        const projectIssues = (localDB.issues || []).filter((i: any) => i.project === p.id || i.project_id === p.id);
        const maxSeq = projectIssues.reduce((max: number, i: any) => Math.max(max, i.sequence_id || 0), 0);
        const sortOrder = typeof p.sort_order === "number" ? p.sort_order : (index + 1) * 10000;
        return Object.assign({}, p, {
          workspace: canonicalWsId || p.workspace,
          workspace_detail: ws || p.workspace_detail,
          member_role: resolvedRole,
          next_work_item_sequence: maxSeq + 1,
          sort_order: sortOrder,
          cycle_view: p.cycle_view ?? true,
          module_view: p.module_view ?? true,
          issue_views_view: p.issue_views_view ?? true,
          page_view: p.page_view ?? true,
          inbox_view: p.inbox_view ?? true,
        });
      });
    return ok(projects);
  }

  // ── Project Detail (GET, PATCH, DELETE) ──────────────────────────────
  const projectDetailMatch = url.match(/\/api\/workspaces\/[^/]+\/projects\/([^/]+)\/?(?:\?.*)?$/);
  if (projectDetailMatch) {
    const projectId = projectDetailMatch[1];
    if (projectId !== "details" && projectId !== "project-identifiers" && projectId !== "search") {
      const deletedSet = new Set(localDB._deleted_project_ids || []);
      const projectIdx = (localDB.projects || []).findIndex(
        (p: any) => p.id === projectId || p.identifier === projectId
      );
      if (projectIdx > -1 && !deletedSet.has(localDB.projects[projectIdx].id)) {
        if (method === "get") {
          const p = localDB.projects[projectIdx];
          const wsSlugMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
          const wsSlug = wsSlugMatch ? wsSlugMatch[1] : null;
          const ws = wsSlug ? (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug) : null;
          const canonicalWsId = ws?.id || wsSlug;

          const currentUserId = activeUser?.id || activeUserId;
          const currentUserEmail = (activeUser?.email || loggedInEmail || "").toLowerCase().trim();
          const pm = (localDB.project_members || []).find((pMember: any) => {
            const pId = pMember.project || pMember.project_id;
            const pMail = (pMember.email || "").toLowerCase().trim();
            const pMem = String(pMember.member || "");
            return (pId === p.id) && (
              (currentUserEmail && pMail === currentUserEmail) ||
              (currentUserId && currentUserId !== "user-default" && pMem === currentUserId)
            );
          });
          const isProjCreator = Boolean(
            (currentUserId && currentUserId !== "user-default" && (p.created_by === currentUserId || p.owner === currentUserId || p.owner?.id === currentUserId)) ||
            (currentUserEmail && (
              (p.created_by && p.created_by.toLowerCase().trim() === currentUserEmail) ||
              (p.owner?.email && p.owner.email.toLowerCase().trim() === currentUserEmail) ||
              (currentUserEmail === "anh2482006@gmail.com" && (!p.created_by || p.created_by === "user-default"))
            ))
          );
          const resolvedRole = (pm && pm.role) ? pm.role : (isProjCreator ? 20 : (p.member_role || 20));
          return ok(Object.assign({}, p, {
            workspace: canonicalWsId || p.workspace,
            workspace_detail: ws || p.workspace_detail,
            member_role: resolvedRole,
            cycle_view: p.cycle_view ?? true,
            module_view: p.module_view ?? true,
            issue_views_view: p.issue_views_view ?? true,
            page_view: p.page_view ?? true,
            inbox_view: p.inbox_view ?? true,
          }));
        }
        if (method === "patch" || method === "put") {
          localDB.projects[projectIdx] = {
            ...localDB.projects[projectIdx],
            ...body,
            updated_at: new Date().toISOString(),
          };
          saveDB();
          syncDAppRecord("projects", projectId, localDB.projects[projectIdx]);
          return ok(localDB.projects[projectIdx]);
        }
        if (method === "delete") {
          const targetProj = localDB.projects[projectIdx];
          const targetId = targetProj?.id || projectId;

          if (!localDB._deleted_project_ids) localDB._deleted_project_ids = [];
          if (!localDB._deleted_project_ids.includes(targetId)) {
            localDB._deleted_project_ids.push(targetId);
          }
          if (targetProj?.identifier && !localDB._deleted_project_ids.includes(targetProj.identifier)) {
            const otherUsingSameIdentifier = (localDB.projects || []).some(
              (p: any) => p.id !== targetId && p.identifier === targetProj.identifier
            );
            if (!otherUsingSameIdentifier) {
              localDB._deleted_project_ids.push(targetProj.identifier);
            }
          }

          const currentDeleted = new Set(localDB._deleted_project_ids);
          localDB.projects = (localDB.projects || []).filter(
            (p: any) => p.id !== targetId && !currentDeleted.has(p.id)
          );

          if (localDB.issues) {
            const deletedProjIssues = localDB.issues.filter(
              (i: any) => i.project === targetId || i.project_id === targetId
            );
            if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
            for (const dpi of deletedProjIssues) {
              if (!localDB._deleted_issue_ids.includes(dpi.id)) {
                localDB._deleted_issue_ids.push(dpi.id);
              }
            }
            localDB.issues = localDB.issues.filter(
              (i: any) => i.project !== targetId && i.project_id !== targetId
            );
          }
          if (localDB.states) {
            localDB.states = localDB.states.filter(
              (s: any) => s.project !== targetId && s.project_id !== targetId
            );
          }
          if (localDB.labels) {
            localDB.labels = localDB.labels.filter(
              (l: any) => l.project !== targetId && l.project_id !== targetId
            );
          }
          if (localDB.cycles) {
            localDB.cycles = localDB.cycles.filter(
              (c: any) => c.project !== targetId && c.project_id !== targetId
            );
          }
          if (localDB.modules) {
            localDB.modules = localDB.modules.filter(
              (m: any) => m.project !== targetId && m.project_id !== targetId
            );
          }
          if (localDB.project_members) {
            localDB.project_members = localDB.project_members.filter(
              (pm: any) => pm.project !== targetId && pm.project_id !== targetId
            );
          }

          saveDB();
          return ok({});
        }
      } else if (method === "get") {
        return { data: { error: "Project not found" }, status: 404 };
      }
    }
  }

  // ── Project Members ──────────────────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/project-members\/me\/?/)) {
    const projMeMatch = url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/project-members\/me\/?/);
    const wsSlug = projMeMatch?.[1] || "";
    const projectId = projMeMatch?.[2] || "";
    const targetProj = (localDB.projects || []).find(
      (p: any) => p.id === projectId || (p.identifier && p.identifier.toLowerCase() === projectId.toLowerCase())
    );
    if (!targetProj) {
      return { data: { error: "Project not found or not authorized" }, status: 404 };
    }
    const targetProjId = targetProj.id || projectId;
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    const activeId = activeUser?.id || activeUserId || "user-default";
    const activeMail = (activeUser?.email || loggedInEmail || "").toLowerCase();

    // Check project membership:
    const pmRecord = (localDB.project_members || []).find(
      (pm: any) =>
        (pm.project === targetProjId || pm.project_id === targetProjId) &&
        (pm.member === activeId ||
          pm.id === activeId ||
          (activeMail && pm.email?.toLowerCase() === activeMail))
    );
    if (pmRecord) {
      return ok({
        id: pmRecord.id || `proj-member-${activeId}`,
        member: activeId,
        role: pmRecord.role || 15,
      });
    }

    const defaultWsSlug = getDefaultWorkspaceSlug();
    const isProjCreator = targetProj.created_by === activeId;
    const isWsAdmin =
      ws?.created_by === activeId ||
      ws?.owner?.id === activeId ||
      (activeMail && ws?.owner?.email?.toLowerCase() === activeMail) ||
      ws?.slug === defaultWsSlug;

    if (targetProj.network === 0 && !isProjCreator && !isWsAdmin) {
      return { data: { error: "You are not a member of this project" }, status: 403 };
    }

    return ok({
      id: "mock-proj-member-me",
      member: activeId,
      role: isWsAdmin || isProjCreator ? 20 : 15,
    });
  }

  const projMembersMatch = url.match(/\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/members\/?(?:\?.*)?$/);
  if (projMembersMatch) {
    const wsSlug = projMembersMatch[1];
    const projectId = projMembersMatch[2];
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    const targetProj = (localDB.projects || []).find(
      (p: any) => p.id === projectId || (p.identifier && p.identifier.toLowerCase() === projectId.toLowerCase())
    );
    const targetProjId = targetProj?.id || projectId;

    if (method === "get") {
      const projMembersList: any[] = [];
      const addedMemberKeys = new Set<string>();

      // 1. Workspace owner or project creator
      const projCreatorId = targetProj?.created_by || ws?.created_by || ws?.owner?.id;
      const projCreatorEmail = (ws?.owner?.email || "").toLowerCase();
      const projCreatorUser = (localDB.users || []).find(
        (u: any) => (projCreatorId && u.id === projCreatorId) || (projCreatorEmail && u.email?.toLowerCase() === projCreatorEmail)
      ) || ws?.owner || {
        id: projCreatorId || "owner-default",
        email: projCreatorEmail,
        first_name: ws?.owner?.first_name || "Owner",
        last_name: ws?.owner?.last_name || "",
        display_name: ws?.owner?.display_name || ws?.owner?.first_name || "Owner",
        avatar_url: "",
        is_active: true,
      };

      const creatorKey = projCreatorUser.id || projCreatorId || "owner-default";
      projMembersList.push({
        id: `proj-member-${creatorKey}`,
        member: {
          id: creatorKey,
          email: projCreatorUser.email || projCreatorEmail,
          first_name: projCreatorUser.first_name || "Owner",
          last_name: projCreatorUser.last_name || "",
          display_name: projCreatorUser.display_name || projCreatorUser.first_name || "Owner",
          avatar_url: projCreatorUser.avatar_url || "",
          is_active: true,
        },
        role: 20,
        project: targetProjId,
        workspace: ws?.id || wsSlug,
      });
      addedMemberKeys.add(creatorKey);
      if (projCreatorEmail) addedMemberKeys.add(projCreatorEmail);

      // 2. Members explicitly in localDB.project_members
      if (localDB.project_members) {
        const pms = localDB.project_members.filter(
          (pm: any) => pm.project === targetProjId || pm.project_id === targetProjId
        );
        pms.forEach((pm: any) => {
          const memberKey = String(pm.member || pm.id);
          const memberMail = (pm.email || (memberKey.includes("@") ? memberKey : "")).toLowerCase();
          if (!addedMemberKeys.has(memberKey) && (!memberMail || !addedMemberKeys.has(memberMail))) {
            const user = (localDB.users || []).find(
              (u: any) => u.id === memberKey || (memberMail && u.email?.toLowerCase() === memberMail)
            );
            projMembersList.push({
              id: pm.id || `proj-member-${memberKey}`,
              member: user || {
                id: memberKey,
                email: pm.email || memberKey,
                first_name: pm.first_name || "Member",
                last_name: pm.last_name || "",
                display_name: pm.display_name || "Member",
                avatar_url: "",
                is_active: true,
              },
              role: pm.role || 15,
              project: targetProjId,
              workspace: ws?.id || wsSlug,
            });
            addedMemberKeys.add(memberKey);
            if (memberMail) addedMemberKeys.add(memberMail);
          }
        });
      }

      // 3. Workspace members available to this project (if public/internal project)
      if (targetProj?.network !== 0) {
        const wsMembers = (localDB.workspace_members || []).filter(
          (m: any) =>
            (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id) &&
            m.is_active !== false
        );

        wsMembers.forEach((wm: any) => {
          const memberKey = String(wm.member || wm.email || wm.id || "");
          const memberMail = (wm.email || (memberKey.includes("@") ? memberKey : "")).toLowerCase();
          if (!addedMemberKeys.has(memberKey) && (!memberMail || !addedMemberKeys.has(memberMail))) {
            const user = (localDB.users || []).find(
              (u: any) => u.id === wm.member || (memberMail && u.email?.toLowerCase() === memberMail) || u.username === wm.member
            );
            const isEth = memberKey.startsWith("0x");
            const shortAddr = isEth ? `${memberKey.slice(0, 6)}...${memberKey.slice(-4)}` : "Member";
            projMembersList.push({
              id: `proj-member-${wm.id}`,
              member: user || {
                id: wm.member || wm.id,
                email: wm.email || (isEth ? `${memberKey}@fiai.network` : memberKey),
                first_name: wm.first_name || shortAddr,
                last_name: wm.last_name || "",
                display_name: wm.display_name || shortAddr,
                avatar_url: "",
                is_active: true,
              },
              role: wm.role || 15,
              project: targetProjId,
              workspace: ws?.id || wsSlug,
            });
            addedMemberKeys.add(memberKey);
            if (memberMail) addedMemberKeys.add(memberMail);
          }
        });
      }

      return ok(projMembersList);
    }

    if (method === "post") {
      if (!localDB.project_members) localDB.project_members = [];
      const membersToAdd = Array.isArray(body?.members) ? body.members : [body];
      const createdList: any[] = [];
      membersToAdd.forEach((m: any) => {
        const memberId = m.member_id || m.member || m.id;
        const pmRecord = {
          id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          project: targetProjId,
          project_id: targetProjId,
          member: memberId,
          role: m.role || 15,
          created_at: new Date().toISOString(),
        };
        localDB.project_members.push(pmRecord);
        createdList.push(pmRecord);
      });
      saveDB();
      return ok(createdList);
    }
  }

  // ── Project Archive / Restore ────────────────────────────────────────
  const archiveMatch = url.match(/\/api\/workspaces\/[^/]+\/projects\/([^/]+)\/archive\/?$/);
  if (archiveMatch) {
    const projectId = archiveMatch[1];
    const project = localDB.projects?.find((p: any) => p.id === projectId);
    if (project) {
      if (method === "post") {
        project.archived_at = new Date().toISOString();
      } else if (method === "delete") {
        project.archived_at = null;
      }
      saveDB();
      syncDAppRecord("projects", projectId, project);
      return ok(project);
    }
    console.log("404 for URL:", url, "method:", method);
    return { data: null, status: 404 };
  }

  // ── Recent Visits & Favorites ────────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/recent-visits\/?(?:\?.*)?$/)) {
    return ok(localDB["recent-visits"] || []);
  }

  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/user-favorites\/?(?:\?.*)?$/)) {
    return ok(localDB.favorites || []);
  }

  // ── Notifications ─────────────────────────────────────────────────── 
  if (url.includes("/notifications")) {
    const notifWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
    const notifWsSlug = notifWsMatch ? notifWsMatch[1] : null;
    const notifWs = notifWsSlug
      ? (localDB.workspaces || []).find((w: any) => w.slug === notifWsSlug || w.id === notifWsSlug)
      : (localDB.workspaces?.[0] || null);
    const canonicalNotifWsId = notifWs?.id || notifWsSlug || "workspace-fiai";
    const validNotifWsKeys = new Set([notifWsSlug, notifWs?.id, notifWs?.slug, canonicalNotifWsId].filter(Boolean));

    const userEmail = (activeUser?.email || loggedInEmail || "").toLowerCase().trim();
    const userId = activeUser?.id || activeUserId;
    const userWallet = (getStoredWalletAddress() || (activeUser as any)?.wallet_address || "").toLowerCase().trim();

    if (!localDB.notifications) localDB.notifications = [];

    // Deduplicate any existing duplicate notifications in localDB.notifications
    if (Array.isArray(localDB.notifications) && localDB.notifications.length > 1) {
      const seenNotifs = new Set<string>();
      const deduped: any[] = [];
      for (const n of localDB.notifications) {
        if (!n || !n.id) continue;
        let dedupKey = String(n.id);
        if (n?.data?.issue_activity?.field === "daily_report") {
          const issueId = n.data?.issue?.id || n.entity_identifier || "";
          const val = n.data?.issue_activity?.new_value || n.message || "";
          const txHash = n.data?.transaction_hash || "";
          const txId = n.data?.transaction_id || "";
          const time = n.created_at ? new Date(n.created_at).getTime() : 0;
          const timeBucket = Math.floor(time / 120000); // 2-minute bucket
          dedupKey = txHash ? `tx:${txHash}` : txId ? `id:${txId}` : `rep:${issueId}:${val}:${timeBucket}`;
        }
        if (seenNotifs.has(dedupKey)) {
          continue;
        }
        seenNotifs.add(dedupKey);
        deduped.push(n);
      }
      if (deduped.length !== localDB.notifications.length) {
        localDB.notifications = deduped;
        saveDB();
      }
    }

    // Comprehensive index of all existing notification keys
    const existingNotifKeys = new Set<string>();
    for (const n of localDB.notifications || []) {
      if (n.id) {
        existingNotifKeys.add(String(n.id));
        if (String(n.id).startsWith("notif-rep-")) existingNotifKeys.add(String(n.id).slice("notif-rep-".length));
        if (String(n.id).startsWith("notif-inv-")) existingNotifKeys.add(String(n.id).slice("notif-inv-".length));
        if (String(n.id).startsWith("notif-report-")) existingNotifKeys.add(String(n.id).slice("notif-report-".length));
      }
      if (n.data?.invitation_id) existingNotifKeys.add(String(n.data.invitation_id));
      if (n.data?.transaction_id) existingNotifKeys.add(String(n.data.transaction_id));
      if (n.data?.transaction_hash) existingNotifKeys.add(String(n.data.transaction_hash));
      if (n.data?.client_event_id) existingNotifKeys.add(String(n.data.client_event_id));
      if (n.data?.issue_activity?.id) {
        const actId = String(n.data.issue_activity.id);
        existingNotifKeys.add(actId);
        if (actId.startsWith("act-")) existingNotifKeys.add(actId.slice(4));
      }
    }

    // Auto-sync stored pending invitations into notifications if missing
    const allStoredInvs = [...(localDB.invitations || []), ...getStoredInvitations()];
    for (const inv of allStoredInvs) {
      if (inv && inv.id && !existingNotifKeys.has(inv.id) && !existingNotifKeys.has(`notif-inv-${inv.id}`)) {
        const invWsSlug = inv.workspace?.slug || inv.workspace_slug || notifWsSlug || "fiai";
        const invWs = (localDB.workspaces || []).find((w: any) => w.slug === invWsSlug || w.id === invWsSlug) || notifWs;
        const invWsId = invWs?.id || invWsSlug;
        const invRole = inv.role || 15;
        localDB.notifications.push({
          id: `notif-inv-${inv.id}`,
          workspace: invWsId,
          workspace_id: invWsId,
          workspace_slug: invWsSlug,
          title: "Workspace Invitation",
          message: `You have been invited to join workspace "${invWs?.name || invWsSlug}"`,
          entity_name: "workspace_invitation",
          entity_identifier: inv.id,
          sender: inv.created_by || "admin",
          receiver: (inv.email || "").toLowerCase().trim(),
          recipient_email: (inv.email || "").toLowerCase().trim(),
          recipient: (inv.email || "").toLowerCase().trim(),
          triggered_by: inv.created_by || "admin",
          triggered_by_details: {
            id: inv.created_by || "admin",
            first_name: "Workspace",
            last_name: "Admin",
            display_name: "Workspace Admin",
            avatar_url: "",
            is_bot: false,
          },
          data: {
            workspace_name: invWs?.name || invWsSlug,
            workspace_slug: invWsSlug,
            role: invRole,
            invitation_id: inv.id,
            invite_link: inv.invite_link || `/workspace-invitations?invitation_id=${inv.id}&slug=${invWsSlug}&token=${inv.token || inv.id}`,
          },
          read_at: null,
          archived_at: null,
          snoozed_till: null,
          is_inbox_issue: false,
          is_mentioned_notification: false,
          created_at: inv.created_at || new Date().toISOString(),
          updated_at: inv.updated_at || new Date().toISOString(),
        });
        existingNotifKeys.add(inv.id);
        existingNotifKeys.add(`notif-inv-${inv.id}`);
      }
    }

    // Auto-sync stored daily reports into notifications if missing
    const existingReportTxs = (localDB["blockchain-transactions"] || []).filter(
      (tx: any) => tx.event_type === "daily_report"
    );
    for (const rep of existingReportTxs) {
      const repKey = rep.transaction_hash || rep.id || rep.client_event_id;
      if (
        repKey &&
        !existingNotifKeys.has(repKey) &&
        !existingNotifKeys.has(`notif-rep-${repKey}`) &&
        !(rep.transaction_hash && existingNotifKeys.has(rep.transaction_hash)) &&
        !(rep.id && existingNotifKeys.has(rep.id)) &&
        !(rep.client_event_id && existingNotifKeys.has(rep.client_event_id))
      ) {
        const repIssue = (localDB.issues || []).find((i: any) => i.id === rep.issue_id);
        const repProj = (localDB.projects || []).find((p: any) => p.id === rep.project || p.id === repIssue?.project);
        const repWs = notifWs;
        const repWsId = repWs?.id || canonicalNotifWsId;
        const repUser = (localDB.users || []).find((u: any) => u.id === rep.reporter_id) || activeUser;
        localDB.notifications.push({
          id: `notif-rep-${repKey}`,
          workspace: repWsId,
          workspace_id: repWsId,
          workspace_slug: repWs?.slug || notifWsSlug || "fiai",
          project: repProj?.id || repIssue?.project || "default-proj",
          project_id: repProj?.id || repIssue?.project || "default-proj",
          entity_identifier: rep.issue_id || repKey,
          entity_name: "issue",
          title: `Báo cáo tiến độ: ${rep.issue_name || repIssue?.name || "Công việc"}`,
          message: rep.work || `Đã cập nhật tiến độ ${rep.progress || 0}%`,
          sender: rep.reporter_id || "user-1",
          receiver: "all",
          recipient_email: "all",
          recipient: "all",
          triggered_by: rep.reporter_id || "user-1",
          triggered_by_details: {
            id: rep.reporter_id || "user-1",
            first_name: repUser?.first_name || rep.reporter_name || "Thành viên",
            last_name: repUser?.last_name || "",
            display_name: repUser?.display_name || rep.reporter_name || repUser?.first_name || "Thành viên",
            avatar_url: repUser?.avatar_url || "",
            is_bot: false,
          },
          data: {
            transaction_id: repKey,
            transaction_hash: rep.transaction_hash || "",
            client_event_id: rep.client_event_id || "",
            issue: {
              id: rep.issue_id || repIssue?.id,
              sequence_id: repIssue?.sequence_id || 1,
              identifier: repProj?.identifier || "TASK",
              name: rep.issue_name || repIssue?.name || "Công việc",
              state_name: repIssue?.state_detail?.name || "In Progress",
              state_group: repIssue?.state_detail?.group || "started",
            },
            issue_activity: {
              id: `act-${repKey}`,
              actor: rep.reporter_id || "user-1",
              field: "daily_report",
              issue_comment: rep.evidence || "",
              verb: "created",
              new_value: `${rep.progress ?? 0}% - ${rep.work || "Báo cáo tiến độ"}`,
              old_value: rep.difficulty ? `Độ khó: ${rep.difficulty}` : "",
            },
          },
          read_at: null,
          archived_at: null,
          snoozed_till: null,
          is_inbox_issue: false,
          is_mentioned_notification: false,
          created_at: rep.recorded_at || rep.created_at || new Date().toISOString(),
          updated_at: rep.recorded_at || rep.created_at || new Date().toISOString(),
        });
        existingNotifKeys.add(repKey);
        existingNotifKeys.add(`notif-rep-${repKey}`);
        if (rep.id) existingNotifKeys.add(rep.id);
        if (rep.transaction_hash) existingNotifKeys.add(rep.transaction_hash);
        if (rep.client_event_id) existingNotifKeys.add(rep.client_event_id);
      }
    }

    const filterNotifForUser = (n: any) => {
      // Workspace check
      if (validNotifWsKeys.size > 0) {
        const nWs = n.workspace || n.workspace_id || n.workspace_slug;
        if (nWs && !validNotifWsKeys.has(nWs)) return false;
      }

      const recipient = (n.recipient_email || n.recipient || n.receiver || "").toLowerCase().trim();
      if (!recipient || recipient === "all" || recipient === "members") return true;

      if (userEmail && (recipient === userEmail || recipient.includes(userEmail) || userEmail.includes(recipient))) return true;
      if (userId && recipient === String(userId).toLowerCase()) return true;
      if (userWallet && (recipient.includes(userWallet) || userWallet.includes(recipient))) return true;

      return false;
    };

    if (url.includes("/notifications/unread")) {
      const userNotifs = (localDB.notifications || []).filter((n: any) => filterNotifForUser(n) && !n.read_at && !n.archived_at);
      return ok({
        total_unread_notifications_count: userNotifs.length,
        mention_unread_notifications_count: 0,
      });
    }

    if (url.includes("/notifications/mark-all-read") && method === "post") {
      (localDB.notifications || []).forEach((n: any) => {
        if (filterNotifForUser(n)) {
          n.read_at = new Date().toISOString();
        }
      });
      saveDB();
      return ok({ message: "Marked all as read" });
    }

    const readMatch = url.match(/\/notifications\/([^/]+)\/read\/?$/);
    if (readMatch) {
      const nId = readMatch[1];
      const targetNotif = (localDB.notifications || []).find((n: any) => n.id === nId);
      if (targetNotif) {
        if (method === "delete") {
          targetNotif.read_at = null;
        } else {
          targetNotif.read_at = new Date().toISOString();
        }
        saveDB();
        return ok(targetNotif);
      }
      return ok({});
    }

    const archiveMatch = url.match(/\/notifications\/([^/]+)\/archive\/?$/);
    if (archiveMatch) {
      const aId = archiveMatch[1];
      const targetNotif = (localDB.notifications || []).find((n: any) => n.id === aId);
      if (targetNotif) {
        if (method === "delete") {
          targetNotif.archived_at = null;
        } else {
          targetNotif.archived_at = new Date().toISOString();
        }
        saveDB();
        return ok(targetNotif);
      }
      return ok({});
    }

    if (method === "get") {
      const seenResultKeys = new Set<string>();
      const userNotifs = (localDB.notifications || [])
        .filter(filterNotifForUser)
        .filter((n: any) => {
          if (!n || !n.id) return false;
          let rKey = String(n.id);
          if (n?.data?.issue_activity?.field === "daily_report") {
            const txH = n.data?.transaction_hash;
            const txI = n.data?.transaction_id;
            const iId = n.data?.issue?.id || n.entity_identifier || "";
            const val = n.data?.issue_activity?.new_value || n.message || "";
            const t = n.created_at ? new Date(n.created_at).getTime() : 0;
            const tb = Math.floor(t / 120000);
            rKey = txH ? `tx:${txH}` : txI ? `id:${txI}` : `rep:${iId}:${val}:${tb}`;
          }
          if (seenResultKeys.has(rKey)) return false;
          seenResultKeys.add(rKey);
          return true;
        })
        .map((n: any) => ({
          ...n,
          workspace: canonicalNotifWsId,
          workspace_id: canonicalNotifWsId,
          is_mentioned_notification: Boolean(n.is_mentioned_notification),
        }));

      return ok({
        results: userNotifs,
        count: userNotifs.length,
        total_count: userNotifs.length,
        total_pages: 1,
        next_page_results: false,
        prev_page_results: false,
        next_cursor: undefined,
        prev_cursor: undefined,
      });
    }

    if (method === "patch" || method === "post") {
      const notifIdMatch = url.match(/\/notifications\/([^/]+)/);
      const notifId = notifIdMatch ? notifIdMatch[1] : null;
      if (notifId && localDB.notifications) {
        const notif = localDB.notifications.find((n: any) => n.id === notifId);
        if (notif) {
          Object.assign(notif, body, { updated_at: new Date().toISOString() });
          saveDB();
          return ok(notif);
        }
      }
      return ok({});
    }

    return ok({});
  }

  // Assets v2 bulk status update
  if (url.match(/\/api\/assets\/v2\/.*\/bulk\/?/) && method === "post") {
    return ok({ success: true, asset_ids: body?.asset_ids || [] });
  }

  // Assets v2
  if (url.match(/\/api\/assets\/v2\//) && method === "post") {
    const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const issueMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/attachments/);
    const issueId = issueMatch ? issueMatch[2] : null;
    if (issueId) {
      if (!localDB["attachments"]) localDB["attachments"] = [];
      localDB["attachments"].push({
        id: assetId,
        asset_id: assetId,
        issue: issueId,
        is_uploaded: false,
        attributes: { name: body?.name || "mock_file.png", size: body?.size || 1024 }
      });
      saveDB();
    }
    return ok({
      asset_id: assetId,
      asset_url: `mock_asset_url_${assetId}`,
      upload_data: {
        url: "mock_upload_url",
        fields: {
          "Content-Type": "image/jpeg",
          key: "mock_key",
          "x-amz-algorithm": "mock_algo",
          "x-amz-credential": "mock_cred",
          "x-amz-date": "mock_date",
          policy: "mock_policy",
          "x-amz-signature": "mock_sig",
        },
      },
    });
  }

  if (url.match(/\/api\/assets\/v2\//) && method === "patch") {
    const assetMatch = url.match(/\/attachments\/([^/]+)\/?/); const assetId = assetMatch ? assetMatch[1] : null; const attachment = (localDB["attachments"] || []).find((a: any) => a.id === assetId || a.asset_id === assetId); if (attachment) { attachment.is_uploaded = true; saveDB(); return ok(attachment); } return ok({ success: true });
  }

  // ── Issue sub-resource endpoints ─────────────────────────────────────
  // subscribe
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/subscribe\/?(?:\?.*)?$/)) {
    if (method === "get") return ok({ subscribed: false });
    if (method === "post") return ok({ subscribed: true });
    if (method === "delete") return ok({ subscribed: false });
  }

  // history / activity — serves both activities and comments depending on activity_type query param
  const historyMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/history\/?(?:\?.*)?$/);
  if (historyMatch && method === "get") {
    const issueId = historyMatch[2];
    // Parse activity_type from query string
    const qsMatch = url.match(/[?&]activity_type=([^&]+)/);
    const activityType = qsMatch ? decodeURIComponent(qsMatch[1]) : null;

    if (activityType === "issue-comment" || activityType === "epic-comment") {
      // Return comments for this issue, formatted as the store expects (TIssueComment)
      const comments = (localDB.comments || []).filter((c: any) => c.issue === issueId || c.issue_id === issueId);
      const issue = (localDB.issues || []).find((i: any) => i.id === issueId);
      const enrichedComments = comments.map((c: any) => ({
        id: c.id,
        issue: issueId,
        issue_detail: issue ? { id: issue.id, name: issue.name, sequence_id: issue.sequence_id } : null,
        comment_html: c.comment_html || c.body || "",
        comment_stripped: c.comment_stripped || "",
        comment_json: c.comment_json || null,
        actor: c.actor || activeUser?.id || "me",
        actor_detail: c.actor_detail || {
          id: c.actor || activeUser?.id || "me",
          first_name: activeUser?.first_name || "Plane",
          last_name: activeUser?.last_name || "Admin",
          is_bot: false,
          display_name: activeUser?.display_name || activeUser?.first_name || "Plane Admin",
          avatar: activeUser?.avatar_url || "",
        },
        created_at: c.created_at,
        updated_at: c.updated_at || c.created_at,
        edited_at: c.edited_at || null,
        comment_reactions: c.comment_reactions || [],
        is_member: true,
        external_source: c.external_source || null,
        workspace: c.workspace || issue?.workspace,
        project: c.project || issue?.project,
        project_id: c.project_id || c.project || issue?.project,
        workspace_id: c.workspace_id || c.workspace || issue?.workspace,
        access: c.access || "INTERNAL",
      }));
      return ok(enrichedComments);
    }

    // Default: return activity history (issue-property type)
    const history = (localDB.history || []).filter((h: any) => h.issue === issueId || h.issue_id === issueId);
    return ok(history);
  }

  // comments
  const commentMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/comments(?:\/([^/?#]+))?\/?(?:\?.*)?$/);
  if (commentMatch) {
    const issueId = commentMatch[2];
    const commentId = commentMatch[3];

    if (commentId) {
      if (method === "patch" || method === "put") {
        if (!localDB.comments) localDB.comments = [];
        const cIdx = localDB.comments.findIndex((c: any) => c.id === commentId);
        if (cIdx > -1) {
          localDB.comments[cIdx] = {
            ...localDB.comments[cIdx],
            ...body,
            updated_at: new Date().toISOString(),
            edited_at: new Date().toISOString(),
          };
          saveDB();
          return ok(localDB.comments[cIdx]);
        }
        return { data: null, status: 404 };
      }
      if (method === "delete") {
        if (localDB.comments) {
          localDB.comments = localDB.comments.filter((c: any) => c.id !== commentId);
          saveDB();
        }
        return ok({});
      }
      if (method === "get") {
        const found = (localDB.comments || []).find((c: any) => c.id === commentId);
        return found ? ok(found) : { data: null, status: 404 };
      }
    }

    if (method === "get") {
      const comments = (localDB.comments || []).filter((c: any) => c.issue === issueId || c.issue_id === issueId);
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const enrichedComments = comments.map((c: any) => ({
        ...c,
        issue_id: issueId,
        project_id: c.project_id || c.project || issue?.project,
        workspace_id: c.workspace_id || c.workspace || issue?.workspace,
        actor: c.actor || activeUser?.id || "me",
        actor_detail: c.actor_detail || {
          id: c.actor || activeUser?.id || "me",
          first_name: activeUser?.first_name || "Plane",
          last_name: activeUser?.last_name || "Admin",
          is_bot: false,
          display_name: activeUser?.display_name || activeUser?.first_name || "Plane Admin",
          avatar: activeUser?.avatar_url || "",
        },
        access: c.access || "INTERNAL",
      }));
      return ok(enrichedComments);
    }
    if (method === "post") {
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const urlWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const urlProjMatch = url.match(/\/projects\/([^/]+)\//);
      const wsSlug = urlWsMatch ? urlWsMatch[1] : issue?.workspace || localDB.workspaces?.[0]?.slug || "";
      const projId = urlProjMatch ? urlProjMatch[1] : issue?.project || "mock-project";
      const authorId = activeUser?.id || "me";

      const newComment = {
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        issue: issueId,
        issue_id: issueId,
        project_id: projId,
        workspace_id: wsSlug,
        project: projId,
        workspace: wsSlug,
        actor: authorId,
        actor_detail: {
          id: authorId,
          first_name: activeUser?.first_name || "Plane",
          last_name: activeUser?.last_name || "Admin",
          is_bot: false,
          display_name: activeUser?.display_name || activeUser?.first_name || "Plane Admin",
          avatar: activeUser?.avatar_url || "",
        },
        access: body.access || "INTERNAL",
        reaction_groups: {},
        created_by: authorId,
        updated_by: authorId,
        comment_html: "",
        comment_json: {},
        comment_stripped: "",
        ...body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (!localDB.comments) localDB.comments = [];
      localDB.comments.push(newComment);
      saveDB();
      return ok(newComment);
    }
    if (method === "delete") {
      if (localDB.comments) {
        const commentIdMatch = url.match(/\/comments\/([^/]+)\/?(?:\?.*)?$/);
        if (commentIdMatch) {
          const commentId = commentIdMatch[1];
          localDB.comments = localDB.comments.filter((c: any) => c.id !== commentId);
          saveDB();
        }
      }
      return ok({});
    }
  }

  // reactions (issues & comments)
  const reactionMatch = url.match(/\/(issues|work-items|epics|comments)\/([^/]+)\/reactions(?:\/([^/]+))?\/?(?:\?.*)?$/);
  if (reactionMatch) {
    const parentType = reactionMatch[1];
    const parentId = reactionMatch[2];
    const reactionParam = reactionMatch[3] ? decodeURIComponent(reactionMatch[3]) : null;

    if (!localDB.issue_reactions) localDB.issue_reactions = [];

    const activeUserId = getLoggedInUserId() || "user-default";
    const activeUser = (localDB.users || []).find((u: any) => u.id === activeUserId) || localDB.users?.[0] || {
      id: activeUserId,
      first_name: "User",
      last_name: "",
      display_name: "User",
      avatar: "",
    };

    if (method === "get") {
      const reactions = localDB.issue_reactions.filter((r: any) => {
        if (parentType === "comments") {
          return r.comment_id === parentId || r.comment === parentId;
        }
        return r.issue_id === parentId || r.issue === parentId;
      });
      return ok(reactions);
    }

    if (method === "post") {
      const emoji = body?.reaction || "thumbsup";
      const existing = localDB.issue_reactions.find((r: any) => {
        const matchesParent = parentType === "comments"
          ? (r.comment_id === parentId || r.comment === parentId)
          : (r.issue_id === parentId || r.issue === parentId);
        return matchesParent && r.reaction === emoji && (r.actor === activeUserId || r.actor === activeUser.id);
      });
      if (existing) {
        return ok(existing);
      }
      const newReaction = {
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        reaction: emoji,
        actor: activeUser.id || activeUserId,
        actor_detail: {
          id: activeUser.id || activeUserId,
          first_name: activeUser.first_name || "User",
          last_name: activeUser.last_name || "",
          display_name: activeUser.display_name || activeUser.first_name || "User",
          avatar: activeUser.avatar || activeUser.avatar_url || "",
          is_bot: false,
        },
        issue: parentType !== "comments" ? parentId : undefined,
        issue_id: parentType !== "comments" ? parentId : undefined,
        comment: parentType === "comments" ? parentId : undefined,
        comment_id: parentType === "comments" ? parentId : undefined,
        created_at: new Date().toISOString(),
      };
      localDB.issue_reactions.push(newReaction);
      saveDB();
      return ok(newReaction);
    }

    if (method === "delete") {
      if (reactionParam) {
        localDB.issue_reactions = localDB.issue_reactions.filter((r: any) => {
          const matchesParent = parentType === "comments"
            ? (r.comment_id === parentId || r.comment === parentId)
            : (r.issue_id === parentId || r.issue === parentId);
          const matchesReaction = r.reaction === reactionParam || r.id === reactionParam;
          const matchesActor = r.actor === activeUserId || r.actor === activeUser.id;
          return !(matchesParent && matchesReaction && matchesActor);
        });
        saveDB();
      }
      return ok({ message: "Reaction deleted successfully" });
    }
  }

  // sub-issues
  const subIssuesMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/sub-issues\/?(?:\?.*)?$/);
  if (subIssuesMatch) {
    const parentId = subIssuesMatch[2];
    const calcDistribution = (items: any[]) => {
      const states = localDB.states || [];
      const dist: Record<string, string[]> = {
        backlog: [],
        unstarted: [],
        started: [],
        completed: [],
        cancelled: [],
      };
      items.forEach((item: any) => {
        const sId = item.state_id || item.state;
        const stateObj = states.find((s: any) => s.id === sId);
        const group = (stateObj?.group || "unstarted").toLowerCase();
        if (dist[group]) {
          dist[group].push(item.id);
        } else {
          dist.unstarted.push(item.id);
        }
      });
      return dist;
    };

    if (method === "get") {
      const subIssues = (localDB.issues || []).filter((i: any) => i.parent_id === parentId || i.parent === parentId);

      const enrichedSubIssues = subIssues.map((item: any) => {
        const children = (localDB.issues || []).filter((i: any) => i.parent_id === item.id || i.parent === item.id);
        const stateDetail = item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail = item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
        return {
          ...item,
          state_detail: stateDetail,
          project_detail: projectDetail,
          sub_issues_count: children.length
        };
      });
      return ok({ sub_issues: enrichedSubIssues, state_distribution: calcDistribution(enrichedSubIssues) });
    }
    if (method === "post") {
      const subIssueIds = body.sub_issue_ids || [];

      let updatedSubIssues: any[] = [];
      if (localDB.issues) {
        localDB.issues = localDB.issues.map((i: any) => {
          if (subIssueIds.includes(i.id)) {
            const updated = { ...i, parent_id: parentId, parent: parentId };
            updatedSubIssues.push(updated);
            return updated;
          }
          return i;
        });

        const allParentSubIssues = localDB.issues.filter((i: any) => i.parent_id === parentId || i.parent === parentId);
        const parentIdx = localDB.issues.findIndex((i: any) => i.id === parentId);
        if (parentIdx > -1) {
          localDB.issues[parentIdx].sub_issues_count = allParentSubIssues.length;
        }
        saveDB();

        return ok({ sub_issues: updatedSubIssues, state_distribution: calcDistribution(allParentSubIssues) });
      }

      return ok({ sub_issues: updatedSubIssues, state_distribution: calcDistribution([]) });
    }
  }

  // issue-relation
  const issueRelationMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/issue-relation\/?(?:\?.*)?$/);
  if (issueRelationMatch) {
    const issueId = issueRelationMatch[2];
    if (!localDB.issue_relations) localDB.issue_relations = [];

    if (method === "get") {
      const relations = localDB.issue_relations.filter((r: any) => r.issue_id === issueId);
      const res: Record<string, any[]> = {
        relates_to: [],
        duplicate: [],
        blocked_by: [],
        blocking: [],
      };
      for (const rel of relations) {
        const relatedIssue = (localDB.issues || []).find((i: any) => i.id === rel.related_issue_id);
        if (relatedIssue && res[rel.relation_type]) {
          const stateDetail =
            relatedIssue.state_detail ||
            (localDB.states || []).find((s: any) => s.id === (relatedIssue.state_id || relatedIssue.state));
          const projectDetail =
            relatedIssue.project_detail ||
            (localDB.projects || []).find((p: any) => p.id === (relatedIssue.project_id || relatedIssue.project));
          res[rel.relation_type].push({
            ...relatedIssue,
            state_detail: stateDetail,
            project_detail: projectDetail,
          });
        }
      }
      return ok(res);
    }

    if (method === "post") {
      const relationType = body?.relation_type || "relates_to";
      const targetIssueIds: string[] = Array.isArray(body?.issues) ? body.issues : [];
      const reverseMap: Record<string, string> = {
        blocked_by: "blocking",
        blocking: "blocked_by",
        duplicate: "duplicate",
        relates_to: "relates_to",
      };
      const reverseRelationType = reverseMap[relationType] || relationType;

      const addedIssues: any[] = [];

      for (const targetId of targetIssueIds) {
        if (!targetId || targetId === issueId) continue;

        // Add forward relation
        const existsForward = localDB.issue_relations.some(
          (r: any) => r.issue_id === issueId && r.related_issue_id === targetId && r.relation_type === relationType
        );
        if (!existsForward) {
          localDB.issue_relations.push({
            id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
            issue_id: issueId,
            related_issue_id: targetId,
            relation_type: relationType,
            created_at: new Date().toISOString(),
          });
        }

        // Add reverse relation
        const existsReverse = localDB.issue_relations.some(
          (r: any) => r.issue_id === targetId && r.related_issue_id === issueId && r.relation_type === reverseRelationType
        );
        if (!existsReverse) {
          localDB.issue_relations.push({
            id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
            issue_id: targetId,
            related_issue_id: issueId,
            relation_type: reverseRelationType,
            created_at: new Date().toISOString(),
          });
        }

        const targetIssue = (localDB.issues || []).find((i: any) => i.id === targetId);
        if (targetIssue) {
          const stateDetail =
            targetIssue.state_detail ||
            (localDB.states || []).find((s: any) => s.id === (targetIssue.state_id || targetIssue.state));
          const projectDetail =
            targetIssue.project_detail ||
            (localDB.projects || []).find((p: any) => p.id === (targetIssue.project_id || targetIssue.project));
          addedIssues.push({
            ...targetIssue,
            state_detail: stateDetail,
            project_detail: projectDetail,
          });
        }
      }

      saveDB();
      return ok(addedIssues);
    }
  }

  // remove-relation
  const removeRelationMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/remove-relation\/?(?:\?.*)?$/);
  if (removeRelationMatch && method === "post") {
    const issueId = removeRelationMatch[2];
    const relationType = body?.relation_type;
    const relatedIssueId = body?.related_issue;
    const reverseMap: Record<string, string> = {
      blocked_by: "blocking",
      blocking: "blocked_by",
      duplicate: "duplicate",
      relates_to: "relates_to",
    };
    const reverseRelationType = reverseMap[relationType] || relationType;

    if (localDB.issue_relations) {
      localDB.issue_relations = localDB.issue_relations.filter(
        (r: any) =>
          !(r.issue_id === issueId && r.related_issue_id === relatedIssueId && r.relation_type === relationType) &&
          !(r.issue_id === relatedIssueId && r.related_issue_id === issueId && r.relation_type === reverseRelationType)
      );
      saveDB();
    }
    return ok({ message: "Relation removed successfully" });
  }

  // links & issue-links
  const linksMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/(links|issue-links)(?:\/([^/]+))?\/?(?:\?.*)?$/);
  if (linksMatch) {
    const issueId = linksMatch[2];
    const linkId = linksMatch[4];
    if (!localDB.issue_links) localDB.issue_links = [];

    if (method === "get") {
      const links = localDB.issue_links.filter((l: any) => l.issue === issueId || l.issue_id === issueId);
      return ok(links);
    }

    if (method === "post") {
      const urlWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const urlProjMatch = url.match(/\/projects\/([^/]+)\//);
      const wsSlug = urlWsMatch ? urlWsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const projId = urlProjMatch ? urlProjMatch[1] : (localDB.projects?.[0]?.id || "");
      const newLinkId = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
      const newLink = {
        id: newLinkId,
        title: body?.title || body?.url || "",
        url: body?.url || "",
        issue: issueId,
        issue_id: issueId,
        project: projId,
        project_id: projId,
        workspace: wsSlug,
        workspace_id: wsSlug,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: getLoggedInUserId() || "user-default",
        ...body,
      };
      localDB.issue_links.push(newLink);
      const targetIssue = (localDB.issues || []).find((i: any) => i.id === issueId);
      if (targetIssue) {
        targetIssue.link_count = (targetIssue.link_count || 0) + 1;
      }
      saveDB();
      return ok(newLink);
    }

    if (method === "patch" || method === "put") {
      if (linkId) {
        const linkIdx = localDB.issue_links.findIndex((l: any) => l.id === linkId);
        if (linkIdx > -1) {
          localDB.issue_links[linkIdx] = {
            ...localDB.issue_links[linkIdx],
            ...body,
            updated_at: new Date().toISOString(),
          };
          saveDB();
          return ok(localDB.issue_links[linkIdx]);
        }
      }
      return ok(body);
    }

    if (method === "delete") {
      if (linkId) {
        localDB.issue_links = localDB.issue_links.filter((l: any) => l.id !== linkId);
        const targetIssue = (localDB.issues || []).find((i: any) => i.id === issueId);
        if (targetIssue && (targetIssue.link_count || 0) > 0) {
          targetIssue.link_count = targetIssue.link_count - 1;
        }
        saveDB();
      }
      return ok({ message: "Link deleted successfully" });
    }
  }

  // attachments
  const attachmentsMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/attachments(?:\/([^/]+))?\/?(?:\?.*)?$/);
  if (attachmentsMatch) {
    const issueId = attachmentsMatch[2];
    const attachmentId = attachmentsMatch[3];
    if (method === "get") {
      if (attachmentId) {
        const found = (localDB["attachments"] || []).find((a: any) => a.id === attachmentId || a.asset === attachmentId);
        return found ? ok(found) : { data: null, status: 404 };
      }
      const attachments = (localDB["attachments"] || []).filter((a: any) => a.issue === issueId || a.issue_id === issueId);
      return ok(attachments);
    }
    if (method === "delete" && attachmentId) {
      if (localDB["attachments"]) {
        localDB["attachments"] = localDB["attachments"].filter((a: any) => a.id !== attachmentId && a.asset !== attachmentId);
        saveDB();
      }
      return ok({});
    }
  }

  // description-versions
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/description-versions\/?(?:\?.*)?$/)) {
    return ok([]);
  }

  // ── 1. Cycles Endpoints ───────────────────────────────────────────────
  // Date check endpoint
  if (url.match(/\/cycles\/date-check\/?(?:\?.*)?$/) && method.toLowerCase() === "post") {
    return ok({ status: true });
  }

  // Progress endpoints
  const cycleProgressMatch = url.match(/\/cycles\/([^/]+)\/(?:progress|cycle-progress)\/?(?:\?.*)?$/);
  if (cycleProgressMatch && method.toLowerCase() === "get") {
    const cycleId = cycleProgressMatch[1];
    const cycleIssues = (localDB.issues || []).filter((i: any) => i.cycle_id === cycleId || i.cycle === cycleId);
    const completed = cycleIssues.filter((i: any) => i.state_detail?.group === "completed" || i.state === "completed").length;
    const started = cycleIssues.filter((i: any) => i.state_detail?.group === "started" || i.state === "started").length;
    const unstarted = cycleIssues.filter((i: any) => i.state_detail?.group === "unstarted" || i.state === "unstarted").length;
    const backlog = cycleIssues.filter((i: any) => i.state_detail?.group === "backlog" || i.state === "backlog").length;
    const cancelled = cycleIssues.filter((i: any) => i.state_detail?.group === "cancelled" || i.state === "cancelled").length;
    return ok({
      total_issues: cycleIssues.length,
      completed_issues: completed,
      started_issues: started,
      unstarted_issues: unstarted,
      backlog_issues: backlog,
      cancelled_issues: cancelled,
    });
  }

  // Analytics endpoint
  const cycleAnalyticsMatch = url.match(/\/cycles\/([^/]+)\/analytics\/?(?:\?.*)?$/);
  if (cycleAnalyticsMatch && method.toLowerCase() === "get") {
    return ok({
      distribution: [],
      estimate_distribution: [],
    });
  }

  // Cycle issues endpoint
  const cycleIssuesMatch = url.match(/\/cycles\/([^/]+)\/cycle-issues(?:\/([^/?#]+))?\/?(?:\?.*)?$/);
  if (cycleIssuesMatch) {
    const cycleId = cycleIssuesMatch[1];
    const bridgeId = cycleIssuesMatch[2];
    if (method.toLowerCase() === "post") {
      const issueIds = Array.isArray(body?.issues) ? body.issues : [];
      if (localDB.issues) {
        localDB.issues.forEach((i: any) => {
          if (issueIds.includes(i.id)) {
            i.cycle_id = cycleId;
            i.cycle = cycleId;
          }
        });
        saveDB();
      }
      return ok({ message: "Issues added to cycle", issues: issueIds });
    }
    if (method.toLowerCase() === "delete") {
      if (localDB.issues && bridgeId) {
        const issue = localDB.issues.find((i: any) => i.id === bridgeId);
        if (issue) {
          issue.cycle_id = null;
          issue.cycle = null;
          saveDB();
        }
      }
      return ok({ message: "Issue removed from cycle" });
    }
    if (method.toLowerCase() === "get") {
      const issues = (localDB.issues || []).filter((i: any) => i.cycle_id === cycleId || i.cycle === cycleId);
      return ok({
        results: issues,
        total_count: issues.length,
        total_results: issues.length,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_pages: 1,
      });
    }
  }

  // Cycle transfer issues endpoint
  const cycleTransferMatch = url.match(/\/cycles\/([^/]+)\/transfer-issues\/?(?:\?.*)?$/);
  if (cycleTransferMatch && method.toLowerCase() === "post") {
    const cycleId = cycleTransferMatch[1];
    const newCycleId = body?.new_cycle_id;
    if (localDB.issues && newCycleId) {
      localDB.issues.forEach((i: any) => {
        if (i.cycle_id === cycleId || i.cycle === cycleId) {
          i.cycle_id = newCycleId;
          i.cycle = newCycleId;
        }
      });
      saveDB();
    }
    return ok({ message: "Issues transferred" });
  }

  // Cycle archive / restore
  const cycleArchiveMatch = url.match(/\/cycles\/([^/]+)\/archive\/?(?:\?.*)?$/);
  if (cycleArchiveMatch) {
    const cycleId = cycleArchiveMatch[1];
    const cycle = (localDB.cycles || []).find((c: any) => c.id === cycleId);
    if (method.toLowerCase() === "post") {
      if (cycle) cycle.archived_at = new Date().toISOString();
      saveDB();
      return ok({ archived_at: cycle?.archived_at || new Date().toISOString() });
    }
    if (method.toLowerCase() === "delete") {
      if (cycle) cycle.archived_at = null;
      saveDB();
      return ok({ message: "Cycle restored" });
    }
  }

  if (url.includes("/archived-cycles") && method.toLowerCase() === "get") {
    const archived = (localDB.cycles || []).filter((c: any) => !!c.archived_at);
    return ok(archived);
  }

  if (url.includes("/user-favorite-cycles")) {
    return ok({ message: "Success" });
  }

  // ── 2. Modules Endpoints ──────────────────────────────────────────────
  // Module issues endpoint (supports both /modules/:id/issues/ and /modules/:id/module-issues/)
  const moduleIssuesMatch = url.match(/\/modules\/([^/]+)\/(?:issues|module-issues)(?:\/([^/?#]+))?\/?(?:\?.*)?$/);
  if (moduleIssuesMatch) {
    const moduleId = moduleIssuesMatch[1];
    const targetIssueId = moduleIssuesMatch[2];
    if (method.toLowerCase() === "post") {
      const issueIds = Array.isArray(body?.issues) ? body.issues : [];
      if (localDB.issues) {
        localDB.issues.forEach((i: any) => {
          if (issueIds.includes(i.id)) {
            const currentModules = Array.isArray(i.module_ids) ? i.module_ids : [];
            if (!currentModules.includes(moduleId)) {
              i.module_ids = [...currentModules, moduleId];
            }
          }
        });
        saveDB();
      }
      return ok({ message: "Issues added to module", issues: issueIds });
    }
    if (method.toLowerCase() === "delete" && targetIssueId) {
      if (localDB.issues) {
        const issue = localDB.issues.find((i: any) => i.id === targetIssueId);
        if (issue && Array.isArray(issue.module_ids)) {
          issue.module_ids = issue.module_ids.filter((m: string) => m !== moduleId);
          saveDB();
        }
      }
      return ok({ message: "Issue removed from module" });
    }
    if (method.toLowerCase() === "get") {
      const issues = (localDB.issues || []).filter((i: any) => {
        return (
          (Array.isArray(i.module_ids) && i.module_ids.includes(moduleId)) ||
          (Array.isArray(i.modules) && i.modules.includes(moduleId)) ||
          i.module === moduleId
        );
      });
      return ok({
        results: issues,
        total_count: issues.length,
        total_results: issues.length,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_pages: 1,
      });
    }
  }

  // Modules attached to an issue
  const issueModulesMatch = url.match(/\/(?:issues|work-items|epics)\/([^/]+)\/modules\/?(?:\?.*)?$/);
  if (issueModulesMatch) {
    const issueId = issueModulesMatch[1];
    if (method.toLowerCase() === "get") {
      const issue = (localDB.issues || []).find((i: any) => i.id === issueId);
      const modIds = new Set(Array.isArray(issue?.module_ids) ? issue.module_ids : []);
      const matchedModules = (localDB.modules || []).filter((m: any) => modIds.has(m.id));
      return ok(matchedModules);
    }
    if (method.toLowerCase() === "post") {
      const issue = (localDB.issues || []).find((i: any) => i.id === issueId);
      if (issue) {
        if (Array.isArray(body?.modules)) {
          issue.module_ids = body.modules;
        }
        saveDB();
      }
      return ok({ ...body });
    }
  }

  // Module archive / restore
  const moduleArchiveMatch = url.match(/\/modules\/([^/]+)\/archive\/?(?:\?.*)?$/);
  if (moduleArchiveMatch) {
    const moduleId = moduleArchiveMatch[1];
    const mod = (localDB.modules || []).find((m: any) => m.id === moduleId);
    if (method.toLowerCase() === "post") {
      if (mod) mod.archived_at = new Date().toISOString();
      saveDB();
      return ok({ archived_at: mod?.archived_at || new Date().toISOString() });
    }
    if (method.toLowerCase() === "delete") {
      if (mod) mod.archived_at = null;
      saveDB();
      return ok({ message: "Module restored" });
    }
  }

  if (url.includes("/archived-modules") && method.toLowerCase() === "get") {
    const archived = (localDB.modules || []).filter((m: any) => !!m.archived_at);
    return ok(archived);
  }

  if (url.includes("/user-favorite-modules")) {
    return ok({ message: "Success" });
  }

  // ── 3. Views Endpoints ────────────────────────────────────────────────
  // View issues endpoint (/views/:id/issues/)
  const viewIssuesMatch = url.match(/\/views\/([^/]+)\/issues\/?(?:\?.*)?$/);
  if (viewIssuesMatch && method.toLowerCase() === "get") {
    const viewId = viewIssuesMatch[1];
    const targetView = (localDB.views || []).find((v: any) => v.id === viewId);
    const projMatch = url.match(/\/projects\/([^/]+)\//);
    const projId = targetView?.project || targetView?.project_id || (projMatch ? projMatch[1] : null);

    const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
    let list = (localDB.issues || []).filter((i: any) => !deletedIssueSet.has(i.id));
    if (projId) {
      list = list.filter((i: any) => i.project === projId || i.project_id === projId);
    }
    return ok({
      results: list,
      total_count: list.length,
      total_results: list.length,
      next_cursor: null,
      prev_cursor: null,
      next_page_results: false,
      prev_page_results: false,
      total_pages: 1,
    });
  }

  if (url.includes("/user-favorite-views")) {
    return ok({ message: "Success" });
  }

  // ── 4. Pages Endpoints ────────────────────────────────────────────────
  // Page description endpoint (/pages/:id/description/)
  const pageDescriptionMatch = url.match(/\/pages\/([^/]+)\/description\/?(?:\?.*)?$/);
  if (pageDescriptionMatch) {
    const pageId = pageDescriptionMatch[1];
    const page = (localDB.pages || []).find((p: any) => p.id === pageId);
    if (method.toLowerCase() === "get") {
      return ok(page?.description_html || page?.description || "");
    }
    if (method.toLowerCase() === "patch") {
      if (page) {
        if (body?.description_html !== undefined) page.description_html = body.description_html;
        if (body?.description_json !== undefined) page.description_json = body.description_json;
        if (body?.description_binary !== undefined) page.description_binary = body.description_binary;
        if (body?.description !== undefined) page.description = body.description;
        page.updated_at = new Date().toISOString();
        saveDB();
      }
      return ok({ message: "Description updated" });
    }
  }

  // Page Actions (access, archive, lock, duplicate, move)
  const pageActionMatch = url.match(/\/pages\/([^/]+)\/(access|archive|lock|duplicate|move)\/?(?:\?.*)?$/);
  if (pageActionMatch) {
    const pageId = pageActionMatch[1];
    const action = pageActionMatch[2];
    const page = (localDB.pages || []).find((p: any) => p.id === pageId);
    if (action === "access" && method.toLowerCase() === "post") {
      if (page && body?.access) page.access = body.access;
      saveDB();
      return ok({ message: "Access updated" });
    }
    if (action === "archive") {
      if (method.toLowerCase() === "post") {
        if (page) page.archived_at = new Date().toISOString();
        saveDB();
        return ok({ archived_at: page?.archived_at || new Date().toISOString() });
      }
      if (method.toLowerCase() === "delete") {
        if (page) page.archived_at = null;
        saveDB();
        return ok({ message: "Page restored" });
      }
    }
    if (action === "lock") {
      if (page) page.is_locked = method.toLowerCase() === "post";
      saveDB();
      return ok({ is_locked: page?.is_locked ?? true });
    }
    if (action === "duplicate" && method.toLowerCase() === "post") {
      if (page) {
        const newPage = {
          ...page,
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: `${page.name} (Copy)`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (!localDB.pages) localDB.pages = [];
        localDB.pages.push(newPage);
        saveDB();
        return ok(newPage);
      }
    }
    if (action === "move" && method.toLowerCase() === "post") {
      if (page && body?.new_project_id) {
        page.project = body.new_project_id;
        page.project_id = body.new_project_id;
        saveDB();
        return ok(page);
      }
    }
  }

  if (url.includes("/favorite-pages")) {
    if (method.toLowerCase() === "get") return ok([]);
    return ok({ message: "Success" });
  }

  if (url.includes("/archived-pages") && method.toLowerCase() === "get") {
    const archivedPages = (localDB.pages || []).filter((p: any) => !!p.archived_at);
    return ok(archivedPages);
  }

  // ── 5. Intake (Inbox) Endpoints ───────────────────────────────────────
  // Intake State endpoint (/intake-state/)
  const intakeStateMatch = url.match(/\/projects\/([^/]+)\/intake-state\/?(?:\?.*)?$/);
  if (intakeStateMatch && method.toLowerCase() === "get") {
    const projectId = intakeStateMatch[1];
    const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
    const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    const wsId = ws?.id || wsSlug;
    return ok({
      id: `intake-state-${projectId}`,
      color: "#3f3f46",
      default: true,
      description: "Intake / Triage State",
      group: "triage",
      name: "Triage",
      project_id: projectId,
      sequence: 10000,
      workspace_id: wsId,
    });
  }

  // Inbox Issues endpoint (/inbox-issues/)
  const inboxIssuesMatch = url.match(/\/projects\/([^/]+)\/inbox-issues(?:\/([^/?#]+))?\/?(?:\?.*)?$/);
  if (inboxIssuesMatch) {
    const projectId = inboxIssuesMatch[1];
    const targetInboxIssueId = inboxIssuesMatch[2];
    const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
    const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    const wsId = ws?.id || wsSlug;

    if (!localDB.inbox_issues) localDB.inbox_issues = [];

    if (method.toLowerCase() === "get") {
      if (targetInboxIssueId) {
        const item = localDB.inbox_issues.find((i: any) => i.id === targetInboxIssueId);
        if (!item) return { data: null, status: 404 };
        return ok(item);
      }
      const list = localDB.inbox_issues
        .filter((i: any) => i.project_id === projectId || i.project === projectId)
        .map((item: any) => {
          const matchedIssue = (localDB.issues || []).find((iss: any) => iss.id === (item.issue_id || item.issue?.id));
          return {
            ...item,
            issue: matchedIssue || item.issue || {},
          };
        });
      return ok({
        results: list,
        total_count: list.length,
        total_results: list.length,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_pages: 1,
      });
    }

    if (method.toLowerCase() === "post") {
      const issueData = body?.issue || body || {};
      const newIssueId = issueData.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
      const projectStates = (localDB.states || []).filter((s: any) => s.project === projectId || s.project_id === projectId);
      const defaultState = projectStates.find((s: any) => s.default) || projectStates[0] || { id: "default-state", name: "Backlog", group: "backlog" };

      const createdIssue = {
        id: newIssueId,
        name: issueData.name || "Untitled issue",
        description_html: issueData.description_html || "",
        project: projectId,
        project_id: projectId,
        workspace: wsId,
        workspace_id: wsId,
        state: issueData.state || defaultState.id,
        state_id: issueData.state || defaultState.id,
        state_detail: defaultState,
        priority: issueData.priority || "none",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: activeUserId || "user-1",
        ...issueData,
      };
      if (!localDB.issues) localDB.issues = [];
      localDB.issues.push(createdIssue);

      const createdInboxIssue = {
        id: body?.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        status: -2, // PENDING
        snoozed_till: null,
        duplicate_to: undefined,
        source: body?.source || "IN_APP",
        issue: createdIssue,
        issue_id: createdIssue.id,
        project: projectId,
        project_id: projectId,
        workspace: wsId,
        workspace_id: wsId,
        created_by: activeUserId || "user-1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      localDB.inbox_issues.push(createdInboxIssue);
      saveDB();
      return ok(createdInboxIssue);
    }

    if (method.toLowerCase() === "patch" && targetInboxIssueId) {
      const idx = localDB.inbox_issues.findIndex((i: any) => i.id === targetInboxIssueId);
      if (idx > -1) {
        localDB.inbox_issues[idx] = {
          ...localDB.inbox_issues[idx],
          ...body,
          updated_at: new Date().toISOString(),
        };
        if (body?.status === 1) {
          const underlyingId = localDB.inbox_issues[idx].issue_id;
          const issue = (localDB.issues || []).find((iss: any) => iss.id === underlyingId);
          if (issue && body?.issue?.state_id) {
            issue.state_id = body.issue.state_id;
            issue.state = body.issue.state_id;
          }
        }
        saveDB();
        return ok(localDB.inbox_issues[idx]);
      }
      return { data: null, status: 404 };
    }

    if (method.toLowerCase() === "delete" && targetInboxIssueId) {
      localDB.inbox_issues = localDB.inbox_issues.filter((i: any) => i.id !== targetInboxIssueId);
      saveDB();
      return ok({ message: "Inbox issue deleted" });
    }
  }


  // ── Workspace Global Search endpoint (Power-K command palette) ───────
  const workspaceSearchMatch = url.match(/\/workspaces\/([^/?]+)\/search(?:\/|\?|$)/);
  if (workspaceSearchMatch && method.toLowerCase() === "get") {
    const wsSlug = workspaceSearchMatch[1];
    return handleWorkspaceGlobalSearch(url, wsSlug);
  }

  // search-issues endpoint — delegate to handleCRUD
  if (url.includes("/search-issues") || url.includes("search-issues")) {
    return handleCRUD(method, url, body);
  }
  // ── Generic CRUD ────────────────────────────────────────────────────
  return handleCRUD(method, url, body);
}

// ── Workspace Global Search handler (Power-K command palette) ─────────────
function handleWorkspaceGlobalSearch(url: string, wsSlug: string): RouteResult {
  let urlObj: URL;
  try {
    urlObj = new URL(url, "http://localhost");
  } catch {
    urlObj = new URL(url.replace(/^[a-zA-Z0-9_-]+:/, ""), "http://localhost");
  }

  const rawSearch = urlObj.searchParams.get("search") || "";
  let searchTerm = "";
  try {
    searchTerm = decodeURIComponent(rawSearch).trim().toLowerCase();
  } catch {
    searchTerm = rawSearch.trim().toLowerCase();
  }

  const workspaceSearch = urlObj.searchParams.get("workspace_search") === "true";
  const projectIdParam = urlObj.searchParams.get("project_id");

  const emptyResult = {
    results: {
      workspace: [],
      project: [],
      issue: [],
      cycle: [],
      module: [],
      issue_view: [],
      page: [],
    },
  };

  if (!searchTerm) {
    return ok(emptyResult);
  }

  // 1. Resolve workspace
  const ws = (localDB.workspaces || []).find(
    (w: any) =>
      w.slug === wsSlug ||
      w.id === wsSlug ||
      w.slug?.toLowerCase() === wsSlug?.toLowerCase()
  );
  const actualWsSlug = ws?.slug || wsSlug;
  const wsId = ws?.id || wsSlug;
  const wsKeys = new Set([wsSlug, actualWsSlug, wsId].filter(Boolean));

  // 2. Resolve projects in workspace
  const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
  const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);

  let allProjects = (localDB.projects || []).filter((p: any) => {
    return wsKeys.has(p.workspace) || wsKeys.has(p.workspace_id);
  });
  if (allProjects.length === 0) {
    allProjects = localDB.projects || [];
  }

  const projectMap = new Map<string, any>();
  allProjects.forEach((p: any) => {
    if (p.id) projectMap.set(p.id, p);
    if (p.identifier) {
      projectMap.set(p.identifier, p);
      projectMap.set(p.identifier.toLowerCase(), p);
    }
  });

  // Target project scope
  const targetProject = allProjects.find(
    (p: any) =>
      p.id === projectIdParam ||
      p.identifier === projectIdParam ||
      p.identifier?.toLowerCase() === projectIdParam?.toLowerCase() ||
      p.name?.toLowerCase() === projectIdParam?.toLowerCase()
  );
  const matchingProjectIds = new Set<string>();
  if (targetProject) {
    if (targetProject.id) matchingProjectIds.add(targetProject.id);
    if (targetProject.identifier) matchingProjectIds.add(targetProject.identifier);
  } else if (projectIdParam) {
    matchingProjectIds.add(projectIdParam);
  }

  // ── 1. Workspaces ──
  const workspaceResults: any[] = [];
  if (workspaceSearch) {
    (localDB.workspaces || []).forEach((w: any) => {
      if (deletedWsSlugs.has(w.slug) || deletedWsIds.has(w.id)) return;
      const nameMatch = (w.name || "").toLowerCase().includes(searchTerm);
      const slugMatch = (w.slug || "").toLowerCase().includes(searchTerm);
      if (nameMatch || slugMatch) {
        workspaceResults.push({
          id: w.id,
          name: w.name || w.slug,
          slug: w.slug,
        });
      }
    });
  }

  // ── 2. Projects ──
  const projectResults: any[] = [];
  if (workspaceSearch) {
    allProjects.forEach((p: any) => {
      const nameMatch = (p.name || "").toLowerCase().includes(searchTerm);
      const identifierMatch = (p.identifier || "").toLowerCase().includes(searchTerm);
      if (nameMatch || identifierMatch) {
        projectResults.push({
          id: p.id,
          identifier: p.identifier || "PROJ",
          name: p.name || "Untitled Project",
          workspace__slug: actualWsSlug,
        });
      }
    });
  }

  // ── 3. Work items (Issues) ──
  const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
  const issueResults: any[] = [];

  (localDB.issues || []).forEach((item: any) => {
    if (deletedIssueSet.has(item.id)) return;
    if (item.is_draft) return;
    if (item.archived_at) return;

    const itemProjId = item.project_id || item.project;
    const proj = itemProjId ? projectMap.get(itemProjId) : null;
    const projIdentifier = proj?.identifier || item.project_detail?.identifier || "PROJ";

    // Scope check: if workspaceSearch is false, restrict to selected project
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      const belongsToProj =
        (itemProjId && matchingProjectIds.has(itemProjId)) ||
        matchingProjectIds.has(projIdentifier);
      if (!belongsToProj) return;
    } else if (workspaceSearch && allProjects.length > 0) {
      // Must belong to current workspace projects or workspace
      const belongsToWs =
        (itemProjId && projectMap.has(itemProjId)) ||
        wsKeys.has(item.workspace) ||
        wsKeys.has(item.workspace_id);
      if (!belongsToWs) return;
    }

    // Match search term against:
    // - issue name
    // - sequence_id
    // - full identifier (e.g. "NET-2")
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    const seqStr = String(item.sequence_id ?? "");
    const seqMatch = seqStr === searchTerm || (seqStr.length > 0 && seqStr.includes(searchTerm));
    const cleanSearchTerm = searchTerm.replace(/^#/, "");
    const fullIdentifier = `${projIdentifier}-${seqStr}`.toLowerCase();
    const identifierMatch =
      fullIdentifier.includes(searchTerm) ||
      fullIdentifier.includes(cleanSearchTerm) ||
      (cleanSearchTerm !== "" && cleanSearchTerm === seqStr);

    if (nameMatch || seqMatch || identifierMatch) {
      issueResults.push({
        id: item.id,
        name: item.name || "",
        project__identifier: projIdentifier,
        project_id: proj?.id || itemProjId,
        sequence_id: item.sequence_id || 0,
        workspace__slug: actualWsSlug,
        type_id: item.type_id || item.type || "",
      });
    }
  });

  // ── 4. Cycles ──
  const cycleResults: any[] = [];
  (localDB.cycles || []).forEach((item: any) => {
    const itemProjId = item.project_id || item.project;
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      if (!itemProjId || !matchingProjectIds.has(itemProjId)) return;
    }
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    if (nameMatch) {
      const proj = itemProjId ? projectMap.get(itemProjId) : null;
      cycleResults.push({
        id: item.id,
        name: item.name || "",
        project_id: proj?.id || itemProjId,
        project__identifier: proj?.identifier || "PROJ",
        workspace__slug: actualWsSlug,
      });
    }
  });

  // ── 5. Modules ──
  const moduleResults: any[] = [];
  (localDB.modules || []).forEach((item: any) => {
    const itemProjId = item.project_id || item.project;
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      if (!itemProjId || !matchingProjectIds.has(itemProjId)) return;
    }
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    if (nameMatch) {
      const proj = itemProjId ? projectMap.get(itemProjId) : null;
      moduleResults.push({
        id: item.id,
        name: item.name || "",
        project_id: proj?.id || itemProjId,
        project__identifier: proj?.identifier || "PROJ",
        workspace__slug: actualWsSlug,
      });
    }
  });

  // ── 6. Views ──
  const viewResults: any[] = [];
  (localDB.views || []).forEach((item: any) => {
    const itemProjId = item.project_id || item.project;
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      if (!itemProjId || !matchingProjectIds.has(itemProjId)) return;
    }
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    if (nameMatch) {
      const proj = itemProjId ? projectMap.get(itemProjId) : null;
      viewResults.push({
        id: item.id,
        name: item.name || "",
        project_id: proj?.id || itemProjId,
        project__identifier: proj?.identifier || "PROJ",
        workspace__slug: actualWsSlug,
      });
    }
  });

  // ── 7. Pages ──
  const pageResults: any[] = [];
  (localDB.pages || []).forEach((item: any) => {
    const itemProjId = item.project_id || item.project;
    if (!workspaceSearch && matchingProjectIds.size > 0) {
      const pids = Array.isArray(item.project_ids)
        ? item.project_ids
        : (itemProjId ? [itemProjId] : []);
      const hasMatch = pids.some((pid: string) => matchingProjectIds.has(pid));
      if (!hasMatch) return;
    }
    const nameMatch = (item.name || "").toLowerCase().includes(searchTerm);
    if (nameMatch) {
      const proj = itemProjId ? projectMap.get(itemProjId) : null;
      const project_ids = Array.isArray(item.project_ids)
        ? item.project_ids
        : (itemProjId ? [itemProjId] : []);
      const project__identifiers = Array.isArray(item.project__identifiers)
        ? item.project__identifiers
        : (proj?.identifier ? [proj.identifier] : []);
      pageResults.push({
        id: item.id,
        name: item.name || "",
        project_ids,
        project__identifiers,
        workspace__slug: actualWsSlug,
      });
    }
  });

  console.log(
    `[DApp Search] term="${searchTerm}", ws="${actualWsSlug}", proj="${projectIdParam || "all"}", results: issues=${issueResults.length}, projects=${projectResults.length}`
  );

  return ok({
    results: {
      workspace: workspaceResults,
      project: projectResults,
      issue: issueResults,
      cycle: cycleResults,
      module: moduleResults,
      issue_view: viewResults,
      page: pageResults,
    },
  });
}

// ── Generic CRUD handler ─────────────────────────────────────────────────
function handleCRUD(method: string, url: string, body: Record<string, any>): RouteResult {
  let { collection, id, isPaginated } = parseApiUrl(url);
  console.log(
    `[DApp CRUD] ${method.toUpperCase()} collection=${collection}, id=${id}, isPaginated=${isPaginated}, url=${url}`
  );

  // Handle workspace global search
  if (collection === "search" && method === "get") {
    const wsMatch = url.match(/\/workspaces\/([^/?]+)/);
    const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    return handleWorkspaceGlobalSearch(url, wsSlug);
  }

  // Handle bulk-delete-issues endpoint
  if (
    (collection === "bulk-delete-issues" || url.includes("/bulk-delete-issues")) &&
    method === "delete"
  ) {
    const issueIds: string[] = Array.isArray(body?.issue_ids) ? body.issue_ids : [];
    if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
    for (const targetId of issueIds) {
      if (!localDB._deleted_issue_ids.includes(targetId)) {
        localDB._deleted_issue_ids.push(targetId);
      }
      const childIssues = (localDB.issues || []).filter(
        (i: any) => i.parent_id === targetId || i.parent === targetId
      );
      for (const child of childIssues) {
        if (!localDB._deleted_issue_ids.includes(child.id)) {
          localDB._deleted_issue_ids.push(child.id);
        }
      }
    }
    const deletedSet = new Set(localDB._deleted_issue_ids);
    localDB.issues = (localDB.issues || []).filter((i: any) => !deletedSet.has(i.id));
    if (localDB.issue_comments) {
      localDB.issue_comments = localDB.issue_comments.filter(
        (c: any) => !deletedSet.has(c.issue || c.issue_id)
      );
    }
    saveDB();
    return ok({ message: "Issues deleted successfully" });
  }

  // Handle bulk-operation-issues endpoint
  if (
    (collection === "bulk-operation-issues" || url.includes("/bulk-operation-issues")) &&
    method === "post"
  ) {
    const issueIds: string[] = Array.isArray(body?.issue_ids) ? body.issue_ids : [];
    const propsToUpdate = body?.properties || {};
    if (localDB.issues) {
      localDB.issues = localDB.issues.map((i: any) => {
        if (issueIds.includes(i.id)) {
          const updated = { ...i, ...propsToUpdate, updated_at: new Date().toISOString() };
          if (propsToUpdate.state_id) {
            updated.state = propsToUpdate.state_id;
            const stateObj = (localDB.states || []).find((s: any) => s.id === propsToUpdate.state_id);
            if (stateObj) updated.state_detail = stateObj;
          }
          return updated;
        }
        return i;
      });
      saveDB();
    }
    return ok({ message: "Issues updated successfully" });
  }

  // Handle bulk-archive-issues endpoint
  if (
    (collection === "bulk-archive-issues" || url.includes("/bulk-archive-issues")) &&
    method === "post"
  ) {
    const issueIds: string[] = Array.isArray(body?.issue_ids) ? body.issue_ids : [];
    const archived_at = new Date().toISOString();
    if (localDB.issues) {
      localDB.issues = localDB.issues.map((i: any) => {
        if (issueIds.includes(i.id)) {
          return { ...i, archived_at };
        }
        return i;
      });
      saveDB();
    }
    return ok({ message: "Issues archived successfully", archived_at });
  }

  // Handle mark-default endpoint for states
  if (url.includes("/states/") && url.includes("/mark-default/") && method === "post") {
    const match = url.match(/\/states\/([^/]+)\/mark-default/);
    const targetStateId = match ? match[1] : id;
    if (targetStateId && localDB.states) {
      const targetState = localDB.states.find((s: any) => s.id === targetStateId);
      if (targetState) {
        const targetProjId = targetState.project || targetState.project_id;
        localDB.states.forEach((s: any) => {
          if (s.project === targetProjId || s.project_id === targetProjId) {
            s.default = s.id === targetStateId;
          }
        });
        saveDB();
        return ok(targetState);
      }
    }
    return ok({ message: "Default state updated" });
  }

  // Handle search-issues directly — return ISearchIssueResponse[] format
  if (collection === "search-issues" && method === "get") {
    const urlObj = new URL(url, "http://localhost");
    const searchTerm = (urlObj.searchParams.get("search") || "").toLowerCase();
    const workspaceSearch = urlObj.searchParams.get("workspace_search") === "true";
    const currentIssueId = urlObj.searchParams.get("issue_id");

    const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
    let list = (localDB.issues || []).filter((item: any) => !deletedIssueSet.has(item.id));
    console.log(`[DApp CRUD] search-issues: total issues in DB = ${list.length}`);

    // Exclude current issue itself if issue_id is provided
    if (currentIssueId) {
      list = list.filter((item: any) => item.id !== currentIssueId);
    }

    // Filter by project if not workspace-level search
    if (!workspaceSearch) {
      const projMatch = url.match(/\/projects\/([^/]+)\//);
      if (projMatch) {
        const projId = projMatch[1];
        list = list.filter((item: any) => item.project === projId || item.project_id === projId);
        console.log(`[DApp CRUD] search-issues: after project filter for ${projId} = ${list.length}`);
      }
    }

    // Filter by search term
    if (searchTerm) {
      list = list.filter((item: any) => (item.name || "").toLowerCase().includes(searchTerm));
    }

    // Map to ISearchIssueResponse format
    const results = list.map((item: any) => {
      const stateDetail =
        item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
      const projectDetail =
        item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
      return {
        id: item.id,
        name: item.name || "",
        project_id: item.project_id || item.project,
        project__identifier: projectDetail?.identifier || "PROJ",
        project__name: projectDetail?.name || "Project",
        sequence_id: item.sequence_id || 0,
        start_date: item.start_date || null,
        state__color: stateDetail?.color || "#a3a3a3",
        state__group: stateDetail?.group || "backlog",
        state__name: stateDetail?.name || "Backlog",
        workspace__slug: item.workspace || localDB.workspaces?.[0]?.slug || "fiai",
        type_id: item.type_id || item.type || null,
      };
    });

    console.log(`[DApp CRUD] search-issues returning ${results.length} results`);
    return ok(results);
  }

  // Handle user-properties / epics-user-properties endpoints
  if (
    collection === "user-properties" ||
    collection === "epics-user-properties" ||
    url.includes("/user-properties/") ||
    url.includes("/epics-user-properties/")
  ) {
    const projMatch = url.match(/\/projects\/([^/]+)\//);
    const projId = projMatch ? projMatch[1] : id;
    const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
    const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
    const key = projId ? `${wsSlug}_${projId}` : wsSlug;

    if (!localDB.user_properties) localDB.user_properties = {};

    const defaultProps = {
      rich_filters: {},
      display_filters: {
        layout: "list",
        order_by: "sort_order",
        group_by: null,
        sub_group_by: null,
        sub_issue: true,
        show_empty_groups: false,
        calendar: {
          show_weekends: false,
          layout: "month",
        },
      },
      display_properties: {
        assignee: true,
        start_date: true,
        due_date: true,
        labels: true,
        priority: true,
        state: true,
        sub_issue_count: true,
        attachment_count: true,
        link: true,
        link_count: true,
        estimate: true,
        key: true,
        created_on: true,
        updated_on: true,
        modules: true,
        cycle: true,
        issue_type: true,
      },
      sort_order: 1,
      preferences: {
        pages: { block_display: true },
        navigation: { default_tab: "issues", hide_in_more_menu: [] },
      },
    };

    if (method === "get") {
      const current = localDB.user_properties[key] || defaultProps;
      return ok(current);
    }

    if (method === "patch" || method === "put" || method === "post") {
      const current = localDB.user_properties[key] || defaultProps;
      const updated = {
        ...current,
        ...body,
        display_filters: {
          ...current.display_filters,
          ...(body?.display_filters || {}),
        },
        display_properties: {
          ...current.display_properties,
          ...(body?.display_properties || {}),
        },
        preferences: {
          ...current.preferences,
          ...(body?.preferences || {}),
        },
      };
      localDB.user_properties[key] = updated;

      // Sync sort_order directly to localDB.projects so it persists
      if (body?.sort_order !== undefined && projId) {
        const pIdx = (localDB.projects || []).findIndex(
          (p: any) => p.id === projId || p.identifier === projId
        );
        if (pIdx > -1) {
          localDB.projects[pIdx].sort_order = body.sort_order;
          syncDAppRecord("projects", localDB.projects[pIdx].id, localDB.projects[pIdx]);
        }
      }

      saveDB();
      return ok(updated);
    }
  }


  // Alias work-items / issues-detail / work-items-detail to issues
  if (
    collection === "work-items" ||
    collection === "issues-detail" ||
    collection === "work-items-detail" ||
    collection === "search-issues"
  ) {
    collection = "issues";
  }

  if (collection === "issue-relation" && method === "get") {
    return ok({ relates_to: [], duplicate: [], blocked_by: [], blocking: [] });
  }
  if (collection === "sub-issues" && method === "get") {
    return ok({
      sub_issues: [],
      state_distribution: { backlog: [], unstarted: [], started: [], completed: [], cancelled: [] },
    });
  }
  if ((collection === "links" || collection === "issue-links") && method === "get") {
    return ok([]);
  }
  if (collection === "reactions" && method === "get") {
    return ok([]);
  }

  // Sub-resource collections that don't have persistent storage — return empty stubs
  const subResourceCollections = [
    "history",
    "comments",
    "subscriptions",
    "description-versions",
    "archive",
  ];
  if (subResourceCollections.includes(collection) && !localDB[collection]?.length) {
    if (method === "get") {
      return ok([]);
    }
  }

  if (collection === "advance-analytics" && method === "get") {
    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    let filteredIssues = issues;
    if (projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    let started = 0;
    let backlog = 0;
    let unstarted = 0;
    let completed = 0;

    filteredIssues.forEach((issue: any) => {
      const stateId = issue.state_id || issue.state;
      const state = states.find((s: any) => s.id === stateId);
      if (state) {
        if (state.group === "started") started++;
        else if (state.group === "backlog") backlog++;
        else if (state.group === "unstarted") unstarted++;
        else if (state.group === "completed" || state.group === "done") completed++;
      }
    });

    return ok({
      total_work_items: { count: filteredIssues.length },
      started_work_items: { count: started },
      backlog_work_items: { count: backlog },
      un_started_work_items: { count: unstarted },
      completed_work_items: { count: completed }
    });
  }

  if (collection === "advance-analytics-stats" && method === "get") {
    const isPeekView = url.includes("/projects/");
    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const users = localDB.users || [];
    const projects = localDB.projects || [];

    let filteredIssues = issues;
    if (isPeekView && projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    if (isPeekView) {
      // Group by assignee
      const assigneeMap: Record<string, any> = {};

      filteredIssues.forEach((issue: any) => {
        let assignees = issue.assignee_ids || issue.assignees || [];
        if (!Array.isArray(assignees)) assignees = [assignees];
        if (assignees.length === 0) assignees = ["unassigned"];

        assignees.forEach((assigneeId: string) => {
          if (!assigneeMap[assigneeId]) {
            let displayName = "Unassigned";
            let avatarUrl = "";
            if (assigneeId !== "unassigned") {
              const user = users.find((u: any) => u.id === assigneeId);
              if (user) {
                displayName = user.display_name || user.first_name || user.name || "User";
                avatarUrl = user.avatar || user.avatar_url || "";
              }
            } else {
              displayName = null as any; // Table displays 'Unassigned' if null
            }
            assigneeMap[assigneeId] = {
              display_name: displayName,
              avatar_url: avatarUrl,
              backlog_work_items: 0,
              started_work_items: 0,
              un_started_work_items: 0,
              completed_work_items: 0,
              cancelled_work_items: 0
            };
          }

          const stateId = issue.state_id || issue.state;
          const state = states.find((s: any) => s.id === stateId);
          if (state) {
            if (state.group === "started") assigneeMap[assigneeId].started_work_items++;
            else if (state.group === "backlog") assigneeMap[assigneeId].backlog_work_items++;
            else if (state.group === "unstarted") assigneeMap[assigneeId].un_started_work_items++;
            else if (state.group === "completed" || state.group === "done") assigneeMap[assigneeId].completed_work_items++;
            else if (state.group === "cancelled") assigneeMap[assigneeId].cancelled_work_items++;
          }
        });
      });

      return ok(Object.values(assigneeMap));
    } else {
      // Group by project
      const projectMap: Record<string, any> = {};
      filteredIssues.forEach((issue: any) => {
        const pid = issue.project_id || issue.project || "unassigned";
        if (!projectMap[pid]) {
          let projectName = "Unknown Project";
          if (pid !== "unassigned") {
            const proj = projects.find((p: any) => p.id === pid);
            if (proj) projectName = proj.name;
          }
          projectMap[pid] = {
            project__name: projectName,
            backlog_work_items: 0,
            started_work_items: 0,
            un_started_work_items: 0,
            completed_work_items: 0,
            cancelled_work_items: 0
          };
        }

        const stateId = issue.state_id || issue.state;
        const state = states.find((s: any) => s.id === stateId);
        if (state) {
          if (state.group === "started") projectMap[pid].started_work_items++;
          else if (state.group === "backlog") projectMap[pid].backlog_work_items++;
          else if (state.group === "unstarted") projectMap[pid].un_started_work_items++;
          else if (state.group === "completed" || state.group === "done") projectMap[pid].completed_work_items++;
          else if (state.group === "cancelled") projectMap[pid].cancelled_work_items++;
        }
      });

      return ok(Object.values(projectMap));
    }
  }

  if (collection === "advance-analytics-charts" && method === "get") {
    const params = new URLSearchParams(url.split("?")[1] || "");
    const type = params.get("type") || "work-items";
    const xAxis = params.get("x_axis");

    const issues = localDB.issues || [];
    const states = localDB.states || [];
    const users = localDB.users || [];

    const projectIdMatch = url.match(/\/projects\/([^/]+)/);
    const projectId = projectIdMatch ? projectIdMatch[1] : null;

    let filteredIssues = issues;
    if (projectId) {
      filteredIssues = issues.filter((i: any) => i.project_id === projectId || i.project === projectId);
    }

    if (type === "work-items") {
      // Created vs Resolved grouped by date
      const dateMap: Record<string, any> = {};

      filteredIssues.forEach((issue: any) => {
        if (issue.created_at) {
          const createdDate = issue.created_at.split("T")[0];
          if (!dateMap[createdDate]) dateMap[createdDate] = { created_issues: 0, completed_issues: 0 };
          dateMap[createdDate].created_issues++;
        }

        const stateId = issue.state_id || issue.state;
        const state = states.find((s: any) => s.id === stateId);
        if (state && (state.group === "completed" || state.group === "done")) {
          const completedDate = (issue.completed_at || issue.updated_at || issue.created_at).split("T")[0];
          if (!dateMap[completedDate]) dateMap[completedDate] = { created_issues: 0, completed_issues: 0 };
          dateMap[completedDate].completed_issues++;
        }
      });

      const mockData = Object.keys(dateMap).sort().map(dateStr => {
        return {
          key: dateStr,
          name: dateStr,
          count: dateMap[dateStr].created_issues + dateMap[dateStr].completed_issues,
          created_issues: dateMap[dateStr].created_issues,
          completed_issues: dateMap[dateStr].completed_issues
        };
      });

      const schema = { created_issues: "Created", completed_issues: "Completed", count: "Count" };
      return ok({ data: mockData, schema });

    } else {
      // Group by x_axis dynamically
      let mockDataMap: Record<string, any> = {};
      let schema: Record<string, string> = { count: "Count" };

      filteredIssues.forEach((issue: any) => {
        let key = "unknown";
        let name = "Unknown";

        if (xAxis === "priority") {
          key = issue.priority || "none";
          name = (key === "none") ? "None" : key;
        } else if (xAxis === "state_id" || xAxis === "state__group") {
          const stateId = issue.state_id || issue.state;
          const state = states.find((s: any) => s.id === stateId);
          if (state) {
            key = xAxis === "state__group" ? state.group : state.name;
            name = state.name;
          }
        } else if (xAxis === "assignees__id") {
          let assignees = issue.assignee_ids || issue.assignees || [];
          if (!Array.isArray(assignees)) assignees = [assignees];
          if (assignees.length === 0) assignees = ["unassigned"];

          if (assignees.length > 0) {
            key = assignees[0];
            if (key === "unassigned") {
              name = "Unassigned";
            } else {
              const user = users.find((u: any) => u.id === key);
              name = user ? (user.display_name || user.first_name || user.name || "User") : key;
            }
          }
        } else if (xAxis === "labels__id") {
          const labels = Array.isArray(issue.labels) ? issue.labels : (issue.label_ids || []);
          if (labels.length > 0) {
            key = labels[0];
            name = "Label " + key; // Simplified for mock
          } else {
            key = "none";
            name = "None";
          }
        }

        if (!mockDataMap[key]) {
          mockDataMap[key] = { key, name, count: 0 };
        }
        mockDataMap[key].count++;

        // Also populate the key in the schema
        if (!schema[key]) {
          schema[key] = name;
        }
        if (mockDataMap[key][key] === undefined) {
          mockDataMap[key][key] = 0;
        }
        mockDataMap[key][key]++;
      });

      return ok({ data: Object.values(mockDataMap), schema });
    }
  }


  if (!localDB[collection]) localDB[collection] = [];

  // Auto-fix missing sequence_id and project_detail for existing issues
  if (collection === "issues") {
    let saveNeeded = false;
    const projectSeqMap: Record<string, number> = {};

    // First pass: find max sequence_id for each project
    localDB.issues.forEach((issue: any) => {
      if (issue.project && issue.sequence_id) {
        projectSeqMap[issue.project] = Math.max(projectSeqMap[issue.project] || 0, issue.sequence_id);
      }
    });

    // Second pass: backfill missing data
    localDB.issues.forEach((issue: any) => {
      if (issue.project && (!issue.sequence_id || !issue.project_detail)) {
        if (!issue.sequence_id) {
          projectSeqMap[issue.project] = (projectSeqMap[issue.project] || 0) + 1;
          issue.sequence_id = projectSeqMap[issue.project];
        }
        if (!issue.project_detail) {
          const project = (localDB.projects || []).find((p: any) => p.id === issue.project);
          if (project) issue.project_detail = project;
        }
        saveNeeded = true;
      }
    });

    if (saveNeeded && method !== "get") saveDB();
  }

  if (method === "get") {
    if (id) {
      let item = localDB[collection].find((r: any) => r.id === id || r.slug === id);

      if (!item && collection === "states") {
        item = (localDB.states || []).find(
          (s: any) => s.id === id || s.group === id || s.name?.toLowerCase() === id?.toLowerCase()
        );
      }

      // Fallback: If id is a number (sequenceId), try finding by project id or identifier
      if (!item && collection === "issues") {
        const projMatch = url.match(/\/projects\/([^/]+)\//);
        console.log(`[DApp Interceptor] Searching for sequence ID ${id}, projMatch:`, projMatch?.[1]);
        if (projMatch) {
          const projOrIdentifier = projMatch[1];
          const seqId = parseInt(id, 10);
          console.log(`[DApp Interceptor] Project: ${projOrIdentifier}, seqId: ${seqId}`);
          if (!isNaN(seqId)) {
            item = localDB.issues.find((r: any) => {
              const match =
                (r.project === projOrIdentifier || r.project_detail?.identifier === projOrIdentifier) &&
                r.sequence_id === seqId;
              return match;
            });
            console.log(`[DApp Interceptor] Fallback seqId result:`, item ? `FOUND ${item.id}` : "NOT FOUND");
          } else if (id === "undefined") {
            item = localDB.issues.find(
              (r: any) => r.project === projOrIdentifier || r.project_detail?.identifier === projOrIdentifier
            );
          }
        }
      }

      // Older fallback for retrieveWithIdentifier (e.g., FIAI-1 or FIAI-undefined)
      if (!item && collection === "issues" && id.includes("-")) {
        const [projIdentifier, seqIdStr] = id.split("-");
        const seqId = parseInt(seqIdStr, 10);
        if (!isNaN(seqId)) {
          item = localDB.issues.find(
            (r: any) => r.project_detail?.identifier === projIdentifier && r.sequence_id === seqId
          );
        } else if (seqIdStr === "undefined") {
          // Special fallback if UI still requests undefined
          item = localDB.issues.find((r: any) => r.project_detail?.identifier === projIdentifier);
        }
      }

      if (!item) {
        return { data: null, status: 404 };
      }
      if (collection === "workspaces" && item) {
        const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
        const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);
        if (deletedWsSlugs.has(item.slug) || deletedWsIds.has(item.id)) {
          return { data: null, status: 404 };
        }
      }
      // Enrich issue/work-item data with defaults expected by the detail store
      if (collection === "issues") {
        const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
        if (deletedIssueSet.has(item.id)) {
          return { data: null, status: 404 };
        }
        const stateDetail =
          item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail =
          item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));
        const issueAttachments = (localDB["attachments"] || []).filter(
          (a: any) => a.issue === item.id || a.issue_id === item.id
        );
        return ok({
          is_subscribed: false,
          issue_reactions: [],
          issue_link: [],
          parent: null,
          ...item,
          issue_attachments: issueAttachments.length > 0 ? issueAttachments : (item.issue_attachments || []),
          project_id: item.project_id || item.project,
          workspace_id: item.workspace_id || item.workspace || item.project_detail?.workspace || "mock-workspace",
          state_id: item.state_id || item.state,
          parent_id: item.parent_id || item.parent,
          cycle_id: item.cycle_id || item.cycle,
          type_id: item.type_id || item.type,
          assignees: item.assignees || item.assignee_ids || [],
          assignee_ids: item.assignee_ids || item.assignees || [],
          labels: item.labels || item.label_ids || [],
          label_ids: item.label_ids || item.labels || [],
          state_detail: stateDetail,
          project_detail: projectDetail,
        });
      }
      if (collection === "projects" && item) {
        const proj = { ...item };
        const currentUserId = getLoggedInUserId();
        const currentUserEmail = (getLoggedInEmail() || "").toLowerCase().trim();
        const activeUser = (localDB.users || []).find((u: any) =>
          (currentUserId && u.id === currentUserId) ||
          (currentUserEmail && u.email?.toLowerCase() === currentUserEmail)
        );
        const resolvedUserId = activeUser?.id || currentUserId;
        const resolvedEmail = (activeUser?.email || currentUserEmail || "").toLowerCase().trim();

        const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
        const wsSlug = wsMatch ? wsMatch[1] : (proj.workspace_detail?.slug || proj.workspace);
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug || w.id === proj.workspace);

        const pm = (localDB.project_members || []).find((pMember: any) => {
          const pId = pMember.project || pMember.project_id;
          const pMail = (pMember.email || "").toLowerCase().trim();
          const pMem = String(pMember.member || "");
          return (pId === proj.id) && (
            (resolvedEmail && pMail === resolvedEmail) ||
            (resolvedUserId && resolvedUserId !== "user-default" && pMem === resolvedUserId)
          );
        });

        const isProjCreator = Boolean(
          (resolvedUserId && resolvedUserId !== "user-default" && (proj.created_by === resolvedUserId || proj.owner === resolvedUserId)) ||
          (resolvedEmail && (
            (proj.created_by && proj.created_by.toLowerCase().trim() === resolvedEmail) ||
            (proj.owner?.email && proj.owner.email.toLowerCase().trim() === resolvedEmail) ||
            (resolvedEmail === "anh2482006@gmail.com" && (!proj.created_by || proj.created_by === "user-default"))
          ))
        );

        if (pm && pm.role) {
          proj.member_role = pm.role;
        } else if (isProjCreator) {
          proj.member_role = 20;
        } else {
          proj.member_role = null;
        }
        proj.cycle_view = proj.cycle_view ?? true;
        proj.module_view = proj.module_view ?? true;
        proj.issue_views_view = proj.issue_views_view ?? true;
        proj.page_view = proj.page_view ?? true;
        proj.inbox_view = proj.inbox_view ?? true;
        return ok(proj);
      }
      if (item && ["cycles", "modules", "views", "pages"].includes(collection)) {
        const enriched = { ...item };
        if (enriched.project && !enriched.project_id) enriched.project_id = enriched.project;
        if (enriched.project_id && !enriched.project) enriched.project = enriched.project_id;
        if (enriched.workspace && !enriched.workspace_id) enriched.workspace_id = enriched.workspace;
        if (enriched.workspace_id && !enriched.workspace) enriched.workspace = enriched.workspace_id;
        return ok(enriched);
      }
      return ok(item);
    }
    let list = localDB[collection] || [];

    // History endpoint should also return comments
    if (collection === "history") {
      const commentsList = localDB["comments"] || [];
      list = [...list, ...commentsList];
    }

    // Auto-seed states for a project if none exist
    if (collection === "states" && url.includes("/projects/")) {
      const projId = id || url.match(/\/projects\/([^/]+)\//)?.[1];
      if (projId) {
        const targetProj = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const matchingProjIds = new Set(
          [projId, targetProj?.id, targetProj?.identifier].filter(Boolean)
        );
        const projStates = list.filter((s: any) => matchingProjIds.has(s.project) || matchingProjIds.has(s.project_id));
        if (projStates.length === 0) {
          const match = url.match(/\/api\/workspaces\/([^/]+)\//);
          const wsSlug = match ? match[1] : "unknown";
          let wsId = wsSlug;
          if (localDB.workspaces) {
            const ws = localDB.workspaces.find((w: any) => w.slug === wsSlug);
            if (ws) wsId = ws.id;
          }
          const actualProjId = targetProj?.id || projId;

          const defaultStates = [
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Backlog",
              group: "backlog",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 15000,
              color: "#a3a3a3",
              default: true,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Unstarted",
              group: "unstarted",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 25000,
              color: "#3f3f46",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Started",
              group: "started",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 35000,
              color: "#f59e0b",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Completed",
              group: "completed",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 45000,
              color: "#16a34a",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Cancelled",
              group: "cancelled",
              project: actualProjId,
              project_id: actualProjId,
              workspace: wsId,
              workspace_id: wsId,
              sequence: 55000,
              color: "#ef4444",
              default: false,
            },
          ];
          list.push(...defaultStates);
          (localDB as any)["states"] = list;
          if (method !== "get") saveDB();
        }
      }
    }

    // Generic _id suffix mapping for all items to satisfy frontend MobX stores
    list = list.map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const res = { ...item };
      if (res.project && !res.project_id) res.project_id = res.project;
      if (res.project_id && !res.project) res.project = res.project_id;
      if (res.workspace && !res.workspace_id) res.workspace_id = res.workspace;
      if (res.workspace_id && !res.workspace) res.workspace = res.workspace_id;
      return res;
    });

    // Filter collections by project ID if the URL is scoped to a project
    if (url.includes("/projects/")) {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const targetProj = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const matchingProjIds = new Set(
          [projId, targetProj?.id, targetProj?.identifier].filter(Boolean)
        );
        if (
          ["issues", "states", "labels", "project-members", "project-roles", "cycles", "modules", "views", "pages", "blockchain-transactions"].includes(collection)
        ) {
          list = list.filter((item: any) => {
            if (matchingProjIds.has(item.project) || matchingProjIds.has(item.project_id)) return true;
            if (collection === "blockchain-transactions" && item.issue_id) {
              const matchedIss = (localDB.issues || []).find((i: any) => i.id === item.issue_id);
              if (matchedIss && (matchingProjIds.has(matchedIss.project) || matchingProjIds.has(matchedIss.project_id))) {
                item.project = matchedIss.project || matchedIss.project_id;
                item.project_id = matchedIss.project_id || matchedIss.project;
                return true;
              }
            }
            return false;
          });
        }
      }
    } else if (url.includes("/workspaces/") && (collection === "labels" || collection === "projects")) {
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        const validWsKeys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));
        list = list.filter((item: any) => {
          const itemWs = item.workspace || item.workspace_id || item.workspace_detail?.id || item.workspace_detail?.slug;
          return validWsKeys.has(itemWs);
        });

        if (collection === "projects") {
          const currentUserId = getLoggedInUserId();
          const currentUserEmail = (getLoggedInEmail() || "").toLowerCase().trim();
          const activeUser = (localDB.users || []).find((u: any) =>
            (currentUserId && u.id === currentUserId) ||
            (currentUserEmail && u.email?.toLowerCase() === currentUserEmail)
          );
          const resolvedUserId = activeUser?.id || currentUserId;
          const resolvedEmail = (activeUser?.email || currentUserEmail || "").toLowerCase().trim();

          list = list.map((item: any) => {
            const proj = { ...item };
            proj.cycle_view = proj.cycle_view ?? true;
            proj.module_view = proj.module_view ?? true;
            proj.issue_views_view = proj.issue_views_view ?? true;
            proj.page_view = proj.page_view ?? true;
            proj.inbox_view = proj.inbox_view ?? true;
            const pm = (localDB.project_members || []).find((pMember: any) => {
              const pId = pMember.project || pMember.project_id;
              const pMail = (pMember.email || "").toLowerCase().trim();
              const pMem = String(pMember.member || "");
              return (pId === proj.id) && (
                (resolvedEmail && pMail === resolvedEmail) ||
                (resolvedUserId && resolvedUserId !== "user-default" && pMem === resolvedUserId)
              );
            });

            const isProjCreator = Boolean(
              (resolvedUserId && resolvedUserId !== "user-default" && (proj.created_by === resolvedUserId || proj.owner === resolvedUserId)) ||
              (resolvedEmail && (
                (proj.created_by && proj.created_by.toLowerCase().trim() === resolvedEmail) ||
                (proj.owner?.email && proj.owner.email.toLowerCase().trim() === resolvedEmail) ||
                (resolvedEmail === "anh2482006@gmail.com" && (!proj.created_by || proj.created_by === "user-default"))
              ))
            );

            if (pm && pm.role) {
              proj.member_role = pm.role;
            } else if (isProjCreator) {
              proj.member_role = 20;
            } else {
              proj.member_role = null;
            }
            return proj;
          });
        }
      }
    }

    // Filter sub-resources by issue ID
    if (["comments", "history", "issue_reactions", "reactions", "issue-links", "links"].includes(collection) && id) {
      list = list.filter((item: any) => item.issue === id || item.issue_id === id);
    }

    if (collection === "blockchain-transactions") {
      try {
        const urlObj = new URL(url, "http://localhost");
        const assigneeIdParam = urlObj.searchParams.get("assignee_id");
        const issueIdParam = urlObj.searchParams.get("issue_id");
        if (assigneeIdParam) {
          list = list.filter((tx: any) => tx.assignee_id === assigneeIdParam || tx.assignee_wallet?.toLowerCase() === assigneeIdParam.toLowerCase());
        }
        if (issueIdParam) {
          list = list.filter((tx: any) => tx.issue_id === issueIdParam);
        }
      } catch { }
    }

    if (collection === "invitations") {
      syncCrossPortWorkspaces();
      const stored = getStoredInvitations();
      if (!localDB.invitations) localDB.invitations = [];
      for (const inv of stored) {
        if (!localDB.invitations.some((i: any) => i.id === inv.id)) {
          localDB.invitations.push(inv);
        }
      }
      list = localDB.invitations || [];
      const wsMatch = url.match(/\/api\/workspaces\/([^/]+)\/invitations/);
      const wsSlug = wsMatch ? wsMatch[1] : null;
      const ws = wsSlug ? (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug) : null;
      const validWsKeys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));

      // Auto-filter out invites for users who are already active workspace members
      const activeWsMemberMails = new Set<string>(
        (localDB.workspace_members || [])
          .filter((m: any) => m.is_active !== false && (validWsKeys.size === 0 || validWsKeys.has(m.workspace) || validWsKeys.has(m.workspace_id)))
          .map((m: any) => (m.email || "").toLowerCase().trim())
          .filter(Boolean)
      );

      // Fix corrupted old records that have `emails: [{ email, role }]` instead of top-level properties
      list = list.map((item: any) => {
        let fixed = { ...item };
        if (!fixed.email && fixed.emails && Array.isArray(fixed.emails) && fixed.emails.length > 0) {
          fixed = {
            ...fixed,
            email: fixed.emails[0].email,
            role: fixed.emails[0].role,
          };
        }
        if (!fixed.invite_link) {
          const itemWsSlug = fixed.workspace?.slug || fixed.workspace_slug || wsSlug || "workspace";
          const tok = fixed.token || fixed.id;
          fixed.invite_link = `/workspace-invitations?invitation_id=${fixed.id}&slug=${itemWsSlug}&token=${tok}`;
        }
        return fixed;
      });
      list = list.filter((item: any) => {
        if (!item.email) return false;
        const mail = item.email.toLowerCase().trim();
        if (item.accepted === true || activeWsMemberMails.has(mail)) return false;
        if (validWsKeys.size > 0) {
          const itemWsSlug = item.workspace?.slug || item.workspace?.id || item.workspace;
          return validWsKeys.has(itemWsSlug);
        }
        return true;
      });

      // Deduplicate pending invites by email in case older duplicates exist
      const seenPendingMails = new Set<string>();
      list = list.filter((item: any) => {
        const mail = (item.email || "").toLowerCase().trim();
        if (seenPendingMails.has(mail)) return false;
        seenPendingMails.add(mail);
        return true;
      });

      console.log(`[DApp Interceptor] Returning invitations:`, JSON.stringify(list));
    }

    // Enrich issues with project_id, workspace_id, and other _id fields (required by UI)
    if (collection === "issues") {
      const deletedIssueSet = new Set(localDB._deleted_issue_ids || []);
      list = list.filter((item: any) => !deletedIssueSet.has(item.id));
      list = list.map((item: any) => {
        const stateDetail =
          item.state_detail || (localDB.states || []).find((s: any) => s.id === (item.state_id || item.state));
        const projectDetail =
          item.project_detail || (localDB.projects || []).find((p: any) => p.id === (item.project_id || item.project));

        const children = (localDB.issues || []).filter((i: any) => i.parent_id === item.id || i.parent === item.id);

        return {
          ...item,
          created_at: item.created_at || item.created_on || new Date().toISOString(),
          updated_at: item.updated_at || item.updated_on || item.created_at || new Date().toISOString(),
          state: item.state_id || item.state,
          project_id: item.project_id || item.project,
          workspace_id: item.workspace_id || item.workspace || item.project_detail?.workspace || localDB.workspaces?.[0]?.slug || "",
          state_id: item.state_id || item.state,
          parent_id: item.parent_id || item.parent,
          cycle_id: item.cycle_id || item.cycle,
          type_id: item.type_id || item.type,
          assignees: item.assignees || item.assignee_ids || [],
          assignee_ids: item.assignee_ids || item.assignees || [],
          labels: item.labels || item.label_ids || [],
          label_ids: item.label_ids || item.labels || [],
          state_detail: stateDetail,
          project_detail: projectDetail,
          sub_issues_count: children.length,
        };
      });

      const urlObj = new URL(url, "http://localhost");
      const subIssueParam = urlObj.searchParams.get("sub_issue");
      const shouldIncludeSubIssues =
        subIssueParam === "true" ||
        url.includes("search-issues") ||
        url.includes("all=true") ||
        !!id;

      if (!shouldIncludeSubIssues) {
        list = list.filter((item: any) => !item.parent_id && !item.parent);
      }
    }

    // Enrich states with project_id and workspace_id
    if (collection === "states") {
      list = list.map((item: any) => ({
        ...item,
        project_id: item.project_id || item.project,
        workspace_id: item.workspace_id || item.workspace || localDB.workspaces?.[0]?.slug || "",
      }));
      console.log(
        `[DApp CRUD] States returning ${list.length} items:`,
        JSON.stringify(list.map((s: any) => ({ id: s.id, name: s.name, project_id: s.project_id })))
      );
    }

    const urlObj = new URL(url, "http://localhost");
    const orderByParam = urlObj.searchParams.get("order_by");
    if (orderByParam && collection === "issues") {
      const isDesc = orderByParam.startsWith("-");
      const sortKey = isDesc ? orderByParam.slice(1) : orderByParam;

      const priorityOrder: Record<string, number> = {
        urgent: 1,
        high: 2,
        medium: 3,
        low: 4,
        none: 5,
      };

      list.sort((a: any, b: any) => {
        let valA: any;
        let valB: any;

        if (sortKey === "sort_order") {
          valA = a.sort_order ?? 0;
          valB = b.sort_order ?? 0;
        } else if (sortKey === "created_at") {
          valA = new Date(a.created_at || a.created_on || 0).getTime();
          valB = new Date(b.created_at || b.created_on || 0).getTime();
        } else if (sortKey === "updated_at") {
          valA = new Date(a.updated_at || a.updated_on || a.created_at || 0).getTime();
          valB = new Date(b.updated_at || b.updated_on || b.created_at || 0).getTime();
        } else if (sortKey === "start_date") {
          valA = a.start_date ? new Date(a.start_date).getTime() : isDesc ? -Infinity : Infinity;
          valB = b.start_date ? new Date(b.start_date).getTime() : isDesc ? -Infinity : Infinity;
        } else if (sortKey === "target_date") {
          valA = a.target_date ? new Date(a.target_date).getTime() : isDesc ? -Infinity : Infinity;
          valB = b.target_date ? new Date(b.target_date).getTime() : isDesc ? -Infinity : Infinity;
        } else if (sortKey === "priority") {
          valA = priorityOrder[a.priority?.toLowerCase() || "none"] ?? 5;
          valB = priorityOrder[b.priority?.toLowerCase() || "none"] ?? 5;
        } else if (sortKey === "state__name") {
          valA = a.state_detail?.name || "";
          valB = b.state_detail?.name || "";
        } else {
          valA = a[sortKey] ?? "";
          valB = b[sortKey] ?? "";
        }

        if (valA < valB) return isDesc ? 1 : -1;
        if (valA > valB) return isDesc ? -1 : 1;
        return 0;
      });
    }

    const groupBy = urlObj.searchParams.get("group_by");

    if (groupBy && groupBy !== "null" && groupBy !== "undefined" && groupBy !== "") {
      const projId = id || url.match(/\/projects\/([^/]+)\//)?.[1];
      const groupedResults: Record<string, any> = {};

      const canonicalGroupBy =
        groupBy === "state_id" || groupBy === "state"
          ? "state"
          : groupBy === "labels__id" || groupBy === "labels"
            ? "labels"
            : groupBy === "assignees__id" || groupBy === "assignees"
              ? "assignees"
              : groupBy === "state__group" || groupBy === "state_detail.group"
                ? "state_detail.group"
                : groupBy === "cycle_id" || groupBy === "cycle"
                  ? "cycle"
                  : groupBy === "issue_module__module_id" || groupBy === "module"
                    ? "module"
                    : groupBy;

      const ensureGroup = (key: string) => {
        if (!groupedResults[key]) {
          groupedResults[key] = { results: [], total_results: 0 };
        }
      };

      const targetProjForGroup = (localDB.projects || []).find(
        (p: any) => p.id === projId || (projId && p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
      );
      const matchingProjIdsForGroup = new Set(
        [projId, targetProjForGroup?.id, targetProjForGroup?.identifier].filter(Boolean)
      );
      const projectStatesForGroup = (localDB.states || []).filter(
        (s: any) => matchingProjIdsForGroup.has(s.project) || matchingProjIdsForGroup.has(s.project_id)
      );

      // Pre-initialize groups so empty groups work and show_empty_groups can render
      if (canonicalGroupBy === "state" && collection === "issues") {
        projectStatesForGroup.forEach((s: any) => ensureGroup(s.id));
        ensureGroup("None");
      } else if (canonicalGroupBy === "priority") {
        ["urgent", "high", "medium", "low", "none"].forEach((p) => ensureGroup(p));
      } else if (canonicalGroupBy === "labels") {
        const labels = (localDB.labels || []).filter(
          (l: any) => matchingProjIdsForGroup.has(l.project) || matchingProjIdsForGroup.has(l.project_id)
        );
        labels.forEach((l: any) => ensureGroup(l.id));
        ensureGroup("None");
      } else if (canonicalGroupBy === "state_detail.group") {
        ["backlog", "unstarted", "started", "completed", "cancelled"].forEach((g) => ensureGroup(g));
      } else if (canonicalGroupBy === "assignees") {
        ensureGroup("None");
      } else if (canonicalGroupBy === "created_by") {
        ensureGroup("None");
      }

      list.forEach((item: any) => {
        if (canonicalGroupBy === "state") {
          let key = item.state_id || item.state;
          const matchingState = projectStatesForGroup.find((s: any) => s.id === key);
          if (!matchingState && projectStatesForGroup.length > 0) {
            const defaultState = projectStatesForGroup.find((s: any) => s.default) || projectStatesForGroup[0];
            key = defaultState.id;
            item.state_id = key;
            item.state = key;
            item.state_detail = defaultState;
          }
          if (!key) key = "None";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else if (canonicalGroupBy === "priority") {
          const key = (item.priority || "none").toLowerCase();
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else if (canonicalGroupBy === "labels") {
          const rawLabels = item.labels || item.label_ids || [];
          const labelIds = (Array.isArray(rawLabels) ? rawLabels : [rawLabels])
            .map((l: any) => (typeof l === "object" && l ? l.id : l))
            .filter(Boolean);
          if (labelIds.length === 0) {
            ensureGroup("None");
            groupedResults["None"].results.push(item);
            groupedResults["None"].total_results++;
          } else {
            labelIds.forEach((lblId: string) => {
              ensureGroup(lblId);
              groupedResults[lblId].results.push(item);
              groupedResults[lblId].total_results++;
            });
          }
        } else if (canonicalGroupBy === "assignees") {
          const rawAssignees = item.assignees || item.assignee_ids || [];
          const assigneeIds = (Array.isArray(rawAssignees) ? rawAssignees : [rawAssignees])
            .map((u: any) => (typeof u === "object" && u ? u.id : u))
            .filter(Boolean);
          if (assigneeIds.length === 0) {
            ensureGroup("None");
            groupedResults["None"].results.push(item);
            groupedResults["None"].total_results++;
          } else {
            assigneeIds.forEach((uId: string) => {
              ensureGroup(uId);
              groupedResults[uId].results.push(item);
              groupedResults[uId].total_results++;
            });
          }
        } else if (canonicalGroupBy === "created_by") {
          const key = item.created_by || "None";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else if (canonicalGroupBy === "state_detail.group") {
          const key = item.state_detail?.group || item.state_group || "backlog";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else if (canonicalGroupBy === "target_date") {
          const key = item.target_date ? item.target_date.split("T")[0] : "None";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        } else {
          const key = item[canonicalGroupBy] || "None";
          ensureGroup(key);
          groupedResults[key].results.push(item);
          groupedResults[key].total_results++;
        }
      });
      return ok({
        results: groupedResults,
        grouped_by: groupBy,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_count: list.length,
        count: list.length,
        total_pages: 1,
        total_results: list.length,
      });
    }

    if (isPaginated) {
      return ok({
        results: list,
        next_cursor: null,
        prev_cursor: null,
        next_page_results: false,
        prev_page_results: false,
        total_count: list.length,
        count: list.length,
        total_pages: 1,
        total_results: list.length,
        extra_stats: null,
      });
    }
    return ok(list);
  }

  if (method === "post") {
    console.log("[DApp Interceptor] POST", collection, body);
    if (collection === "invitations" && body.emails && Array.isArray(body.emails)) {
      const match = url.match(/\/api\/workspaces\/([^/]+)\//);
      const wsSlug = match ? match[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const currentWs = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);

      if (!localDB[collection]) localDB[collection] = [];
      const newInvites: any[] = [];

      for (const e of body.emails) {
        const rawEmail = (e.email || "").toLowerCase().trim();
        if (!rawEmail) continue;

        const existingInv = localDB[collection].find(
          (inv: any) =>
            (inv.email || "").toLowerCase().trim() === rawEmail &&
            !inv.accepted &&
            (inv.workspace_slug === wsSlug || inv.workspace?.slug === wsSlug || inv.workspace_id === currentWs?.id || inv.workspace?.id === currentWs?.id)
        );

        if (existingInv) {
          existingInv.role = e.role || existingInv.role || 15;
          existingInv.updated_at = new Date().toISOString();
          newInvites.push(existingInv);
          console.log(`[DApp Interceptor] Updated existing pending invite for ${rawEmail} (${existingInv.id})`);
        } else {
          const invId = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
          const token = `tok-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const createdInv = {
            id: invId,
            token: token,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            email: e.email,
            role: e.role || 15,
            accepted: false,
            responded_at: null,
            message: "You have been invited.",
            invite_link: `/workspace-invitations?invitation_id=${invId}&slug=${wsSlug}&token=${token}`,
            workspace: {
              id: currentWs?.id || wsSlug,
              name: currentWs?.name || wsSlug,
              slug: wsSlug,
              logo_url: currentWs?.logo_url || "",
            },
            workspace_id: currentWs?.id || wsSlug,
            workspace_slug: wsSlug,
          };
          localDB[collection].push(createdInv);
          newInvites.push(createdInv);
          console.log(`[DApp Interceptor] Created new invite for ${rawEmail} (${invId})`);
        }
      }
      saveStoredInvitations(localDB[collection]);

      if (!localDB.notifications) localDB.notifications = [];
      const invWsId = currentWs?.id || wsSlug;
      body.emails.forEach((e: any) => {
        const rawMail = (e.email || "").toLowerCase().trim();
        const matchingInv = newInvites.find((inv: any) => (inv.email || "").toLowerCase().trim() === rawMail);
        const invId = matchingInv?.id || `inv-${Date.now()}`;
        const inviteLink = matchingInv?.invite_link || `/workspace-invitations?invitation_id=${invId}&slug=${wsSlug}&token=${matchingInv?.token || invId}`;

        localDB.notifications.push({
          id: `notif-inv-${invId}`,
          workspace: invWsId,
          workspace_id: invWsId,
          workspace_slug: wsSlug,
          title: "Workspace Invitation",
          message: `You have been invited to join workspace "${currentWs?.name || wsSlug}"`,
          entity_name: "workspace_invitation",
          entity_identifier: invId,
          sender: activeUserId || "admin",
          receiver: rawMail,
          recipient_email: rawMail,
          recipient: rawMail,
          triggered_by: activeUserId || "admin",
          triggered_by_details: {
            id: activeUser?.id || activeUserId || "admin",
            first_name: activeUser?.first_name || "Workspace",
            last_name: activeUser?.last_name || "Admin",
            display_name: activeUser?.display_name || activeUser?.first_name || "Workspace Admin",
            avatar_url: activeUser?.avatar_url || "",
            is_bot: false,
          },
          data: {
            workspace_name: currentWs?.name || wsSlug,
            workspace_slug: wsSlug,
            role: e.role || 15,
            invitation_id: invId,
            invite_link: inviteLink,
          },
          read_at: null,
          archived_at: null,
          snoozed_till: null,
          is_inbox_issue: false,
          is_mentioned_notification: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      });

      // Xử lý từng invitee: kích hoạt addMember on-chain nếu có địa chỉ ví
      for (const e of body.emails) {
        const memberAddress = extractEthAddress(e.email);

        // Gọi smart contract PlaneWorkspaceRegistry.addMember
        const bridge = getFiaiSDK();
        const wsRegistryAddr = getWorkspaceRegistryAddress();
        if (memberAddress && wsRegistryAddr && bridge && currentUserAddress) {
          const contractRole = mapPlaneRoleToContractRole(e.role);
          bridge
            .request("sendTransaction", {
              from: currentUserAddress,
              to: wsRegistryAddr,
              abiData: [ADD_MEMBER_ABI],
              functionName: "addMember",
              feeType: "sc",
              amount: "0",
              value: "0",
              gas: getContractGas(),
              type: "transaction",
              inputArray: [
                { name: "slug", type: "string", value: wsSlug },
                { name: "member", type: "address", value: memberAddress },
                { name: "role", type: "uint8", value: String(contractRole) },
              ],
              isReadOnly: false,
              bundleId: "",
            })
            .then(() => {
              console.log(`[DApp Interceptor] ✅ Đã thêm thành viên on-chain: ${memberAddress} vào workspace: ${wsSlug}`);
              return true;
            })
            .catch((err: any) => {
              console.warn(`[DApp Interceptor] addMember on-chain thất bại:`, err);
            });
        }
      }

      saveDB();
      newInvites.forEach((inv) => syncDAppRecord(collection, inv.id, inv));
      void uploadToIPFS(true);
      return ok({ message: "Invitations sent successfully" });
    }

    const newRecord: any = {
      id: body.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...body,
    };
    const activeUserId = getLoggedInUserId();
    const activeUser = localDB.users?.find((u: any) => u.id === activeUserId);

    if (collection === "blockchain-transactions") {
      newRecord.recorded_at = new Date().toISOString();
      if (newRecord.event_type === "assign_task" && !newRecord.assignee_name && newRecord.assignee_id) {
        const assignee = localDB.users?.find((usr: any) => usr.id === newRecord.assignee_id);
        newRecord.assignee_name = assignee?.display_name || assignee?.first_name || newRecord.assignee_id;
      }
      if (
        (newRecord.event_type === "daily_report" || newRecord.event_type === "task_content") &&
        !newRecord.reporter_name
      ) {
        newRecord.reporter_id = activeUserId;
        newRecord.reporter_name = activeUser?.display_name || activeUser?.first_name || activeUserId;
      }

      // Generate in-app notifications for daily reports and task assignments
      if (!localDB.notifications) localDB.notifications = [];
      const wsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const wsSlug = wsMatch ? wsMatch[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const currentWs = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
      const canonicalWsId = currentWs?.id || wsSlug;

      const projMatch = url.match(/\/projects\/([^/]+)\//);
      const projId = projMatch ? projMatch[1] : (newRecord.project || newRecord.project_id);
      const targetProj = (localDB.projects || []).find((p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === String(projId).toLowerCase()));
      const targetProjId = targetProj?.id || projId || "default-proj";
      const targetIssue = (localDB.issues || []).find((i: any) => i.id === newRecord.issue_id);

      newRecord.project = targetProjId;
      newRecord.project_id = targetProjId;
      newRecord.workspace = canonicalWsId;
      newRecord.workspace_id = canonicalWsId;
      newRecord.workspace_slug = wsSlug;
      if (!newRecord.issue_name && targetIssue?.name) {
        newRecord.issue_name = targetIssue.name;
      }

      const reporterUserObj = activeUser || (localDB.users || []).find((u: any) => u.id === newRecord.reporter_id) || {
        id: newRecord.reporter_id || activeUserId || "user-1",
        first_name: newRecord.reporter_name || "Thành viên",
        last_name: "",
        display_name: newRecord.reporter_name || "Thành viên",
        avatar_url: "",
        is_bot: false,
      };

      if (newRecord.event_type === "daily_report") {
        const repKey = newRecord.transaction_hash || newRecord.id || newRecord.client_event_id || `${Date.now()}`;
        const notifId = `notif-rep-${repKey}`;
        const alreadyExists = (localDB.notifications || []).some(
          (n: any) =>
            n.id === notifId ||
            n.data?.transaction_id === repKey ||
            (newRecord.transaction_hash && n.data?.transaction_hash === newRecord.transaction_hash) ||
            (newRecord.id && n.data?.transaction_id === newRecord.id)
        );
        if (!alreadyExists) {
          localDB.notifications.unshift({
            id: notifId,
            workspace: canonicalWsId,
            workspace_id: canonicalWsId,
            workspace_slug: wsSlug,
            project: targetProjId,
            project_id: targetProjId,
            entity_identifier: targetIssue?.id || newRecord.issue_id,
            entity_name: "issue",
            title: `Báo cáo tiến độ: ${targetIssue?.name || newRecord.issue_name || "Công việc"}`,
            message: newRecord.work || `Đã cập nhật tiến độ ${newRecord.progress || 0}%`,
            sender: reporterUserObj.id,
            receiver: "all",
            recipient_email: "all",
            recipient: "all",
            triggered_by: reporterUserObj.id,
            triggered_by_details: {
              id: reporterUserObj.id,
              first_name: reporterUserObj.first_name || newRecord.reporter_name || "Thành viên",
              last_name: reporterUserObj.last_name || "",
              display_name: reporterUserObj.display_name || newRecord.reporter_name || reporterUserObj.first_name || "Thành viên",
              avatar_url: reporterUserObj.avatar_url || "",
              is_bot: false,
            },
            data: {
              transaction_id: repKey,
              transaction_hash: newRecord.transaction_hash || "",
              client_event_id: newRecord.client_event_id || "",
              issue: {
                id: targetIssue?.id || newRecord.issue_id,
                sequence_id: targetIssue?.sequence_id || 1,
                identifier: targetProj?.identifier || "TASK",
                name: targetIssue?.name || newRecord.issue_name || "Công việc",
                state_name: targetIssue?.state_detail?.name || "In Progress",
                state_group: targetIssue?.state_detail?.group || "started",
              },
              issue_activity: {
                id: `act-${repKey}`,
                actor: reporterUserObj.id,
                field: "daily_report",
                issue_comment: newRecord.evidence || "",
                verb: "created",
                new_value: `${newRecord.progress ?? 0}% - ${newRecord.work || "Báo cáo công việc"}`,
                old_value: newRecord.difficulty ? `Độ khó: ${newRecord.difficulty}` : "",
              },
            },
            read_at: null,
            archived_at: null,
            snoozed_till: null,
            is_inbox_issue: false,
            is_mentioned_notification: false,
            created_at: newRecord.recorded_at || new Date().toISOString(),
            updated_at: newRecord.recorded_at || new Date().toISOString(),
            created_by: reporterUserObj.id,
          });
        }
      } else if (newRecord.event_type === "assign_task") {
        const notifId = `notif-assign-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        localDB.notifications.unshift({
          id: notifId,
          workspace: canonicalWsId,
          workspace_id: canonicalWsId,
          workspace_slug: wsSlug,
          project: targetProjId,
          project_id: targetProjId,
          entity_identifier: targetIssue?.id || newRecord.issue_id,
          entity_name: "issue",
          title: `Giao việc: ${targetIssue?.name || newRecord.issue_name || "Công việc"}`,
          message: `Đã giao công việc cho ${newRecord.assignee_name || "bạn"}`,
          sender: reporterUserObj.id,
          receiver: newRecord.assignee_id || "all",
          recipient_email: newRecord.assignee_id || "all",
          recipient: newRecord.assignee_id || "all",
          triggered_by: reporterUserObj.id,
          triggered_by_details: {
            id: reporterUserObj.id,
            first_name: reporterUserObj.first_name || "Quản trị",
            last_name: reporterUserObj.last_name || "",
            display_name: reporterUserObj.display_name || reporterUserObj.first_name || "Quản trị",
            avatar_url: reporterUserObj.avatar_url || "",
            is_bot: false,
          },
          data: {
            issue: {
              id: targetIssue?.id || newRecord.issue_id,
              sequence_id: targetIssue?.sequence_id || 1,
              identifier: targetProj?.identifier || "TASK",
              name: targetIssue?.name || newRecord.issue_name || "Công việc",
              state_name: targetIssue?.state_detail?.name || "Assigned",
              state_group: targetIssue?.state_detail?.group || "unstarted",
            },
            issue_activity: {
              id: `act-${Date.now()}`,
              actor: reporterUserObj.id,
              field: "assignees",
              issue_comment: "",
              verb: "created",
              new_value: newRecord.assignee_name || "bạn",
              old_value: "",
            },
          },
          read_at: null,
          archived_at: null,
          snoozed_till: null,
          is_inbox_issue: false,
          is_mentioned_notification: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: reporterUserObj.id,
        });
      }
    }
    if (collection === "workspaces" && !newRecord.slug)
      newRecord.slug = newRecord.name?.toLowerCase().replace(/\s+/g, "-");
    if (collection === "workspaces" && !newRecord.owner) {
      newRecord.owner = {
        id: activeUser?.id || "user-1",
        email: activeUser?.email || "",
        first_name: activeUser?.first_name || "User",
        last_name: activeUser?.last_name || "",
        avatar: activeUser?.avatar_url || "",
      };
      newRecord.created_by = activeUser?.id || "user-1";
    }
    if (collection === "projects") {
      if (localDB._deleted_project_ids && Array.isArray(localDB._deleted_project_ids)) {
        localDB._deleted_project_ids = localDB._deleted_project_ids.filter(
          (dId: string) => dId !== newRecord.id && dId !== newRecord.identifier
        );
      }
      const match = url.match(/\/api\/workspaces\/([^/]+)\//);
      const wsSlug = match ? match[1] : (localDB.workspaces?.[0]?.slug || "fiai");
      const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
      
      const activeCreatorId = activeUser?.id || activeUserId || "user-default";
      const activeCreatorEmail = (activeUser?.email || getLoggedInEmail() || "").toLowerCase().trim();
      const creatorUserObj = activeUser || (localDB.users || []).find((u: any) => u.id === activeCreatorId) || (localDB.users || [])[0];

      newRecord.workspace = ws?.id || wsSlug;
      newRecord.workspace_detail = ws || { id: newRecord.workspace, slug: wsSlug, name: wsSlug.toUpperCase() };
      newRecord.created_by = activeCreatorId;
      newRecord.owner = creatorUserObj;
      newRecord.member_role = 20;

      // Seed default states for the new project
      if (!localDB["states"]) localDB["states"] = [];
      const defaultStates = [
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Backlog",
          group: "backlog",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 15000,
          color: "#a3a3a3",
          default: true,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Unstarted",
          group: "unstarted",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 25000,
          color: "#3f3f46",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Started",
          group: "started",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 35000,
          color: "#f59e0b",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Completed",
          group: "completed",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 45000,
          color: "#16a34a",
          default: false,
        },
        {
          id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
          name: "Cancelled",
          group: "cancelled",
          project: newRecord.id,
          workspace: newRecord.workspace,
          sequence: 55000,
          color: "#ef4444",
          default: false,
        },
      ];
      localDB["states"].push(...defaultStates);

      if (!localDB.project_members) localDB.project_members = [];
      const existingPmIdx = localDB.project_members.findIndex(
        (pm: any) =>
          (pm.project === newRecord.id || pm.project_id === newRecord.id) &&
          (pm.member === activeCreatorId || (activeCreatorEmail && (pm.email || "").toLowerCase().trim() === activeCreatorEmail))
      );
      if (existingPmIdx === -1) {
        localDB.project_members.push({
          id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          project: newRecord.id,
          project_id: newRecord.id,
          member: activeCreatorId,
          email: activeCreatorEmail,
          role: 20,
          created_at: new Date().toISOString(),
        });
      }
      void uploadToIPFS(true);
    }
    if (collection === "issues") {
      if (localDB._deleted_issue_ids && Array.isArray(localDB._deleted_issue_ids)) {
        localDB._deleted_issue_ids = localDB._deleted_issue_ids.filter(
          (dId: string) => dId !== newRecord.id
        );
      }
      // Find the project ID from the URL: /api/workspaces/.../projects/:projectId/issues/
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const project = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const canonicalProjId = project?.id || projId;
        newRecord.project = canonicalProjId;
        newRecord.project_id = canonicalProjId;
        if (project) {
          newRecord.project_detail = project;
        }

        const validProjKeys = new Set([projId, project?.id, project?.identifier].filter(Boolean));
        // Auto-increment sequence_id for the project
        const projectIssues = (localDB.issues || []).filter(
          (i: any) => validProjKeys.has(i.project) || validProjKeys.has(i.project_id)
        );
        const maxSeq = projectIssues.reduce((max: number, issue: any) => Math.max(max, issue.sequence_id || 0), 0);
        newRecord.sequence_id = maxSeq + 1;

        // Ensure state_id belongs to this project
        const projStates = (localDB.states || []).filter(
          (s: any) => validProjKeys.has(s.project) || validProjKeys.has(s.project_id)
        );
        const stateMatches = projStates.find(
          (s: any) => s.id === (newRecord.state_id || newRecord.state)
        );
        if (!stateMatches && projStates.length > 0) {
          const defaultState = projStates.find((s: any) => s.default) || projStates[0];
          newRecord.state_id = defaultState.id;
          newRecord.state = defaultState.id;
          newRecord.state_detail = defaultState;
        } else if (stateMatches) {
          newRecord.state_id = stateMatches.id;
          newRecord.state = stateMatches.id;
          newRecord.state_detail = stateMatches;
        }
      }

      if (newRecord.parent_id === "" || newRecord.parent_id === "null" || newRecord.parent_id === "undefined") {
        newRecord.parent_id = null;
      }
      if (newRecord.parent === "" || newRecord.parent === "null" || newRecord.parent === "undefined") {
        newRecord.parent = null;
      }
      if (newRecord.cycle_id === "" || newRecord.cycle_id === "null" || newRecord.cycle_id === "undefined") {
        newRecord.cycle_id = null;
      }
    }

    if (collection === "labels") {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const project = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const canonicalProjId = project?.id || projId;
        newRecord.project = canonicalProjId;
        newRecord.project_id = canonicalProjId;
      }
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        newRecord.workspace = ws?.id || wsSlug;
        newRecord.workspace_id = ws?.id || wsSlug;
      }
      if (!newRecord.color) newRecord.color = "#3f3f46";
      newRecord.parent = newRecord.parent || null;
      if (newRecord.sort_order === undefined) {
        const projLabels = (localDB.labels || []).filter(
          (l: any) => l.project === newRecord.project || l.project_id === newRecord.project_id
        );
        newRecord.sort_order = projLabels.length * 10000 + 10000;
      }
    }

    if (collection === "states") {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const project = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const canonicalProjId = project?.id || projId;
        newRecord.project = canonicalProjId;
        newRecord.project_id = canonicalProjId;
      }
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        newRecord.workspace = ws?.id || wsSlug;
        newRecord.workspace_id = ws?.id || wsSlug;
      }
      if (!newRecord.color) newRecord.color = "#3f3f46";
      if (newRecord.default === undefined) newRecord.default = false;
      if (newRecord.sequence === undefined) {
        const projStates = (localDB.states || []).filter(
          (s: any) =>
            (s.project === newRecord.project || s.project_id === newRecord.project_id) &&
            s.group === newRecord.group
        );
        const maxSeq = projStates.reduce((max: number, s: any) => Math.max(max, s.sequence || 0), 0);
        newRecord.sequence = maxSeq > 0 ? maxSeq + 10000 : 15000;
      }
    }

    if (["cycles", "modules", "views", "pages"].includes(collection)) {
      const match = url.match(/\/projects\/([^/]+)\//);
      if (match) {
        const projId = match[1];
        const project = (localDB.projects || []).find(
          (p: any) => p.id === projId || (p.identifier && p.identifier.toLowerCase() === projId.toLowerCase())
        );
        const canonicalProjId = project?.id || projId;
        newRecord.project = canonicalProjId;
        newRecord.project_id = canonicalProjId;
        if (project) {
          newRecord.project_detail = project;
        }
      }
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        newRecord.workspace = ws?.id || wsSlug;
        newRecord.workspace_id = ws?.id || wsSlug;
        if (ws) {
          newRecord.workspace_detail = ws;
        }
      }
      newRecord.owned_by = newRecord.owned_by || activeUserId || "user-1";
      newRecord.created_by = newRecord.created_by || activeUserId || "user-1";
      if (collection === "views") {
        newRecord.query_data = newRecord.query_data || {};
      }
      if (collection === "pages") {
        newRecord.access = newRecord.access ?? 0;
        newRecord.color = newRecord.color || "#3f3f46";
        newRecord.description_html = newRecord.description_html || "<p></p>";
      }
    }

    if (collection === "projects" && newRecord.sort_order === undefined) {
      newRecord.sort_order = ((localDB.projects || []).length + 1) * 10000;
    }

    if (!localDB[collection]) localDB[collection] = [];
    localDB[collection].push(newRecord);

    // If this is an issue and it has a parent, update the parent's sub_issues_count
    if (collection === "issues" && newRecord.parent_id) {
      const parentIdx = localDB[collection].findIndex((i: any) => i.id === newRecord.parent_id);
      if (parentIdx > -1) {
        localDB[collection][parentIdx].sub_issues_count = (localDB[collection][parentIdx].sub_issues_count || 0) + 1;
        // Broadcast the parent update if needed, though for mock DB just saving is enough for next fetch
      }
    }

    saveDB();
    syncDAppRecord(collection, newRecord.id, newRecord);

    let returnedRecord = { ...newRecord };

    if (collection === "projects") {
      returnedRecord.member_role = 20;
      returnedRecord.created_by = newRecord.created_by;
      returnedRecord.owner = newRecord.owner;
      returnedRecord.workspace = newRecord.workspace;
      returnedRecord.workspace_detail = newRecord.workspace_detail;
      returnedRecord.cycle_view = returnedRecord.cycle_view ?? true;
      returnedRecord.module_view = returnedRecord.module_view ?? true;
      returnedRecord.issue_views_view = returnedRecord.issue_views_view ?? true;
      returnedRecord.page_view = returnedRecord.page_view ?? true;
      returnedRecord.inbox_view = returnedRecord.inbox_view ?? true;
    }

    // Generic mapping for all records
    if (returnedRecord.project && !returnedRecord.project_id) returnedRecord.project_id = returnedRecord.project;
    if (returnedRecord.project_id && !returnedRecord.project) returnedRecord.project = returnedRecord.project_id;
    if (returnedRecord.workspace && !returnedRecord.workspace_id)
      returnedRecord.workspace_id = returnedRecord.workspace;
    if (returnedRecord.workspace_id && !returnedRecord.workspace)
      returnedRecord.workspace = returnedRecord.workspace_id;

    if (collection === "issues") {
      const stateDetail =
        returnedRecord.state_detail ||
        (localDB.states || []).find((s: any) => s.id === (returnedRecord.state_id || returnedRecord.state));
      const projectDetail =
        returnedRecord.project_detail ||
        (localDB.projects || []).find((p: any) => p.id === (returnedRecord.project_id || returnedRecord.project));
      returnedRecord = {
        ...returnedRecord,
        project_id: returnedRecord.project_id || returnedRecord.project,
        workspace_id:
          returnedRecord.workspace_id ||
          returnedRecord.workspace ||
          returnedRecord.project_detail?.workspace ||
          localDB.workspaces?.[0]?.slug ||
          "",
        state_id: returnedRecord.state_id || returnedRecord.state,
        parent_id: returnedRecord.parent_id || returnedRecord.parent,
        cycle_id: returnedRecord.cycle_id || returnedRecord.cycle,
        type_id: returnedRecord.type_id || returnedRecord.type,
        assignees: returnedRecord.assignees || returnedRecord.assignee_ids || [],
        assignee_ids: returnedRecord.assignee_ids || returnedRecord.assignees || [],
        labels: returnedRecord.labels || returnedRecord.label_ids || [],
        label_ids: returnedRecord.label_ids || returnedRecord.labels || [],
        state_detail: stateDetail,
        project_detail: projectDetail,
      };
    }

    if (["comments", "history", "issue_reactions"].includes(collection) && id) {
      newRecord.issue = id;
      newRecord.issue_id = id;
    }

    return { data: returnedRecord, status: 201 };
  }

  if (method === "patch" || method === "put") {
    if (!localDB[collection]) localDB[collection] = [];
    let idx = localDB[collection].findIndex((r: any) => r.id === id || r.slug === id);
    if (idx === -1 && collection === "issues" && id) {
      const projMatch = url.match(/\/projects\/([^/]+)\//);
      const projOrIdentifier = projMatch ? projMatch[1] : null;
      const seqId = parseInt(id, 10);
      if (!isNaN(seqId) && projOrIdentifier) {
        idx = localDB.issues.findIndex(
          (r: any) =>
            (r.project === projOrIdentifier ||
              r.project_id === projOrIdentifier ||
              r.project_detail?.identifier === projOrIdentifier) &&
            r.sequence_id === seqId
        );
      }
      if (idx === -1 && id.includes("-")) {
        const [projIdentifier, seqIdStr] = id.split("-");
        const sId = parseInt(seqIdStr, 10);
        if (!isNaN(sId)) {
          idx = localDB.issues.findIndex(
            (r: any) => r.project_detail?.identifier === projIdentifier && r.sequence_id === sId
          );
        }
      }
    }
    if (idx > -1) {
      localDB[collection][idx] = { ...localDB[collection][idx], ...body, updated_at: new Date().toISOString() };
      if (collection === "issues") {
        if (body.state_id) localDB[collection][idx].state = body.state_id;
        if (body.state) localDB[collection][idx].state_id = body.state;
      }
      saveDB();
      syncDAppRecord(collection, id!, localDB[collection][idx]);

      let returnedRecord = { ...localDB[collection][idx] };
      if (collection === "issues") {
        returnedRecord = {
          ...returnedRecord,
          project_id: returnedRecord.project_id || returnedRecord.project,
          workspace_id:
            returnedRecord.workspace_id ||
            returnedRecord.workspace ||
            returnedRecord.project_detail?.workspace ||
            localDB.workspaces?.[0]?.slug ||
            "",
          state_id: returnedRecord.state_id || returnedRecord.state,
          parent_id: returnedRecord.parent_id || returnedRecord.parent,
          cycle_id: returnedRecord.cycle_id || returnedRecord.cycle,
          type_id: returnedRecord.type_id || returnedRecord.type,
        };
      }

      // Generic mapping for all other records
      if (returnedRecord.project && !returnedRecord.project_id) returnedRecord.project_id = returnedRecord.project;
      if (returnedRecord.workspace && !returnedRecord.workspace_id)
        returnedRecord.workspace_id = returnedRecord.workspace;

      return ok(returnedRecord);
    }
    console.log("404 for URL:", url, "method:", method);
    return { data: null, status: 404 };
  }

  if (method === "delete") {
    if (collection === "workspaces" && id) {
      const targetWs = (localDB.workspaces || []).find((w: any) => w.id === id || w.slug === id);
      const targetId = targetWs?.id || id;
      const targetSlug = targetWs?.slug || id;

      if (!localDB._deleted_workspace_ids) localDB._deleted_workspace_ids = [];
      if (!localDB._deleted_workspace_ids.includes(targetId)) {
        localDB._deleted_workspace_ids.push(targetId);
      }
      if (!localDB._deleted_workspace_slugs) localDB._deleted_workspace_slugs = [];
      if (!localDB._deleted_workspace_slugs.includes(targetSlug)) {
        localDB._deleted_workspace_slugs.push(targetSlug);
      }

      const deletedWsIds = new Set(localDB._deleted_workspace_ids);
      const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs);

      // 1. Remove from localDB.workspaces
      localDB.workspaces = (localDB.workspaces || []).filter(
        (w: any) => w.id !== targetId && w.slug !== targetSlug && !deletedWsIds.has(w.id) && !deletedWsSlugs.has(w.slug)
      );

      // 2. Cascade delete all projects belonging to this workspace
      const deletedProjects = (localDB.projects || []).filter(
        (p: any) => p.workspace === targetId || p.workspace === targetSlug || p.workspace_id === targetId || p.workspace_id === targetSlug
      );
      if (!localDB._deleted_project_ids) localDB._deleted_project_ids = [];
      for (const dp of deletedProjects) {
        if (!localDB._deleted_project_ids.includes(dp.id)) localDB._deleted_project_ids.push(dp.id);
        if (dp.identifier && !localDB._deleted_project_ids.includes(dp.identifier)) localDB._deleted_project_ids.push(dp.identifier);
      }
      const currentDeletedProjSet = new Set(localDB._deleted_project_ids);
      localDB.projects = (localDB.projects || []).filter(
        (p: any) => p.workspace !== targetId && p.workspace !== targetSlug && p.workspace_id !== targetId && p.workspace_id !== targetSlug && !currentDeletedProjSet.has(p.id)
      );

      // 3. Cascade delete all issues for those projects or this workspace
      if (localDB.issues) {
        const deletedProjIds = new Set(deletedProjects.map((p: any) => p.id));
        const deletedIssues = localDB.issues.filter(
          (i: any) => deletedProjIds.has(i.project) || deletedProjIds.has(i.project_id) || i.workspace === targetId || i.workspace === targetSlug
        );
        if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
        for (const di of deletedIssues) {
          if (!localDB._deleted_issue_ids.includes(di.id)) localDB._deleted_issue_ids.push(di.id);
        }
        const currentDeletedIssueSet = new Set(localDB._deleted_issue_ids);
        localDB.issues = localDB.issues.filter(
          (i: any) => !deletedProjIds.has(i.project) && !deletedProjIds.has(i.project_id) && i.workspace !== targetId && i.workspace !== targetSlug && !currentDeletedIssueSet.has(i.id)
        );
      }

      // 4. Cascade delete states, labels, cycles, modules, workspace_members
      if (localDB.states) {
        localDB.states = localDB.states.filter((s: any) => s.workspace !== targetId && s.workspace !== targetSlug);
      }
      if (localDB.labels) {
        localDB.labels = localDB.labels.filter((l: any) => l.workspace !== targetId && l.workspace !== targetSlug);
      }
      if (localDB.cycles) {
        localDB.cycles = localDB.cycles.filter((c: any) => c.workspace !== targetId && c.workspace !== targetSlug);
      }
      if (localDB.modules) {
        localDB.modules = localDB.modules.filter((m: any) => m.workspace !== targetId && m.workspace !== targetSlug);
      }
      if (localDB.views) {
        localDB.views = localDB.views.filter((v: any) => v.workspace !== targetId && v.workspace !== targetSlug);
      }
      if (localDB.pages) {
        localDB.pages = localDB.pages.filter((p: any) => p.workspace !== targetId && p.workspace !== targetSlug);
      }
      if (localDB.inbox_issues) {
        localDB.inbox_issues = localDB.inbox_issues.filter((i: any) => i.workspace !== targetId && i.workspace !== targetSlug);
      }
      if (localDB.workspace_members) {
        localDB.workspace_members = localDB.workspace_members.filter(
          (m: any) => m.workspace !== targetId && m.workspace !== targetSlug && m.workspace_id !== targetId && m.workspace_id !== targetSlug
        );
      }

      // 5. Update activeUser
      const remainingWs = (localDB.workspaces && localDB.workspaces.length > 0) ? localDB.workspaces[0] : null;
      const activeUserId = getLoggedInUserId();
      const loggedInEmail = typeof window !== "undefined" ? localStorage.getItem("plane_dapp_auth_email") : null;
      const activeUser = (localDB.users || []).find((u: any) =>
        (activeUserId && u.id === activeUserId) ||
        (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase())
      ) || localDB.users?.[0] || null;

      if (activeUser) {
        if (activeUser.last_workspace_slug === targetSlug || activeUser.last_workspace_id === targetId) {
          activeUser.last_workspace_slug = remainingWs ? remainingWs.slug : null;
          activeUser.last_workspace_id = remainingWs ? remainingWs.id : null;
        }
      }

      // 6. Update localStorage and document.cookie
      if (typeof window !== "undefined") {
        try {
          if (localStorage.getItem("last_workspace_slug") === targetSlug) {
            if (remainingWs) {
              localStorage.setItem("last_workspace_slug", remainingWs.slug);
            } else {
              localStorage.removeItem("last_workspace_slug");
            }
          }
          if (remainingWs) {
            document.cookie = `last_workspace_slug=${remainingWs.slug}; path=/; max-age=31536000; SameSite=Lax`;
          } else {
            document.cookie = `last_workspace_slug=; path=/; max-age=0; SameSite=Lax`;
          }
          document.cookie = `plane_dapp_sync_workspaces=${encodeURIComponent(JSON.stringify(localDB.workspaces))}; path=/; max-age=31536000; SameSite=Lax`;
        } catch { }
      }

      saveDB();
      return ok({ message: "Workspace deleted successfully" });
    } else if (collection === "projects" && id) {
      const targetProj = (localDB.projects || []).find((p: any) => p.id === id || p.identifier === id);
      const targetId = targetProj?.id || id;

      if (!localDB._deleted_project_ids) localDB._deleted_project_ids = [];
      if (!localDB._deleted_project_ids.includes(targetId)) {
        localDB._deleted_project_ids.push(targetId);
      }
      if (targetProj?.identifier && !localDB._deleted_project_ids.includes(targetProj.identifier)) {
        const otherUsingSameIdentifier = (localDB.projects || []).some(
          (p: any) => p.id !== targetId && p.identifier === targetProj.identifier
        );
        if (!otherUsingSameIdentifier) {
          localDB._deleted_project_ids.push(targetProj.identifier);
        }
      }

      const deletedSet = new Set(localDB._deleted_project_ids);
      localDB.projects = (localDB.projects || []).filter(
        (p: any) => p.id !== targetId && !deletedSet.has(p.id)
      );

      if (localDB.issues) {
        const deletedProjIssues = localDB.issues.filter(
          (i: any) => i.project === targetId || i.project_id === targetId
        );
        if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
        for (const dpi of deletedProjIssues) {
          if (!localDB._deleted_issue_ids.includes(dpi.id)) {
            localDB._deleted_issue_ids.push(dpi.id);
          }
        }
        localDB.issues = localDB.issues.filter((i: any) => i.project !== targetId && i.project_id !== targetId);
      }
      if (localDB.states) {
        localDB.states = localDB.states.filter((s: any) => s.project !== targetId && s.project_id !== targetId);
      }
      if (localDB.labels) {
        localDB.labels = localDB.labels.filter((l: any) => l.project !== targetId && l.project_id !== targetId);
      }
      if (localDB.cycles) {
        localDB.cycles = localDB.cycles.filter((c: any) => c.project !== targetId && c.project_id !== targetId);
      }
      if (localDB.modules) {
        localDB.modules = localDB.modules.filter((m: any) => m.project !== targetId && m.project_id !== targetId);
      }
      if (localDB.views) {
        localDB.views = localDB.views.filter((v: any) => v.project !== targetId && v.project_id !== targetId);
      }
      if (localDB.pages) {
        localDB.pages = localDB.pages.filter((p: any) => p.project !== targetId && p.project_id !== targetId);
      }
      if (localDB.inbox_issues) {
        localDB.inbox_issues = localDB.inbox_issues.filter((i: any) => i.project !== targetId && i.project_id !== targetId);
      }
      if (localDB.project_members) {
        localDB.project_members = localDB.project_members.filter((pm: any) => pm.project !== targetId && pm.project_id !== targetId);
      }
    } else if (collection === "issues" && id) {
      if (!localDB._deleted_issue_ids) localDB._deleted_issue_ids = [];
      if (!localDB._deleted_issue_ids.includes(id)) {
        localDB._deleted_issue_ids.push(id);
      }
      // Also collect all child / sub-issue IDs so they don't orphan or resurrect
      const childIssues = (localDB.issues || []).filter((i: any) => i.parent_id === id || i.parent === id);
      for (const child of childIssues) {
        if (!localDB._deleted_issue_ids.includes(child.id)) {
          localDB._deleted_issue_ids.push(child.id);
        }
      }
      const deletedIssueSet = new Set(localDB._deleted_issue_ids);
      localDB.issues = (localDB.issues || []).filter(
        (r: any) => !deletedIssueSet.has(r.id) && r.parent_id !== id && r.parent !== id
      );
      if (localDB.issue_comments) {
        localDB.issue_comments = localDB.issue_comments.filter(
          (c: any) => !deletedIssueSet.has(c.issue || c.issue_id)
        );
      }
    } else if (collection === "invitations" && id) {
      removeStoredInvitation(id);
    } else {
      localDB[collection] = (localDB[collection] || []).filter((r: any) => r.id !== id);
    }
    saveDB();
    return ok({});
  }

  return ok(null);
}

function ok(data: any): RouteResult {
  return { data, status: 200 };
}

// ── URL → collection parser ──────────────────────────────────────────────
function parseApiUrl(url: string): { collection: string; id: string | null; isPaginated: boolean } {
  const clean = url.split("?")[0].replace(/\/+$/, ""); // strip query and trailing slash
  const segments = clean.split("/").filter(Boolean); // e.g. ["api","workspaces","ws","projects","p","issues","id","history"]

  // Must start with "api"
  const apiIdx = segments.indexOf("api");
  if (apiIdx === -1) return { collection: "general", id: null, isPaginated: false };

  const rest = segments.slice(apiIdx + 1); // everything after "api"

  // Special cases: direct workspace or project routes
  if (rest.length === 2 && rest[0] === "workspaces") {
    return { collection: "workspaces", id: rest[1], isPaginated: false };
  }
  if (rest.length === 4 && rest[0] === "workspaces" && rest[2] === "projects") {
    if (rest[3] === "details") {
      return { collection: "projects", id: null, isPaginated: false };
    }
    return { collection: "projects", id: rest[3], isPaginated: false };
  }

  // Skip known structural prefixes to find the meaningful resource segments
  // Pattern: workspaces/:slug/projects/:pid/[v2/]<resource>[/:id[/<sub-resource>[/:subId]]]
  let i = 0;

  // skip "workspaces/:slug"
  if (rest[i] === "workspaces" && rest[i + 1]) i += 2;
  // skip "projects/:pid" only if there are deeper sub-resource segments
  if (rest[i] === "projects" && rest[i + 1] && rest.length > i + 2) i += 2;
  // skip "v2" prefix
  if (rest[i] === "v2") i += 1;

  const resourceSegments = rest.slice(i); // e.g. ["issues","id","history"] or ["issues"] or ["issues","id"]

  if (resourceSegments.length === 0) {
    return { collection: "general", id: null, isPaginated: false };
  }

  // Normalize aliases so they match localDB collection names
  if (resourceSegments[0] === "issue-labels" || resourceSegments[0] === "issue_labels") {
    resourceSegments[0] = "labels";
  }

  if (resourceSegments.length === 1) {
    // /api/.../issues/
    const unpaginated = [
      "members",
      "invitations",
      "states",
      "labels",
      "project-roles",
      "workspace-members",
      "project-members",
      "projects",
      "workspaces",
      "cycles",
      "modules",
      "views",
      "pages",
      "project-identifiers",
      "project-stats",
      "blockchain-transactions",
      "search-issues",
      "user-properties",
      "epics-user-properties",
      "project-deploy-boards",
    ];
    const collection = resourceSegments[0];
    return { collection, id: null, isPaginated: !unpaginated.includes(collection) };
  }

  if (resourceSegments.length === 2) {
    const [resource, idOrSub] = resourceSegments;
    // Special case: "list" is not an id but a sub-endpoint
    if (idOrSub === "list") {
      return { collection: resource, id: null, isPaginated: true };
    }
    // /api/.../issues/:id
    return { collection: resource, id: idOrSub, isPaginated: false };
  }

  if (resourceSegments.length === 3) {
    // /api/.../issues/:id/history  or /api/.../issues/:id/comments
    const [_parentResource, parentId, subResource] = resourceSegments;
    const unpaginatedSub = [
      "comments",
      "history",
      "issue_reactions",
      "reactions",
      "links",
      "issue-links",
      "sub-issues",
      "issue-relation",
    ];
    // Return the sub-resource as collection, with the parent id for context
    return { collection: subResource, id: parentId, isPaginated: !unpaginatedSub.includes(subResource) };
  }

  if (resourceSegments.length >= 4) {
    // /api/.../issues/:id/comments/:commentId
    const subResource = resourceSegments[2];
    const subId = resourceSegments[3];
    return { collection: subResource, id: subId, isPaginated: false };
  }

  return { collection: "general", id: null, isPaginated: false };
}

