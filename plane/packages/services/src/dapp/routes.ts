import type { RouteResult } from "./types";
import { hashPassword, getStoredCredentials, setStoredCredential, createUserObject } from "./auth";
import {
  localDB,
  saveDB,
  getLoggedInUserId,
  getLoggedInEmail,
  isLoggedIn,
  setLoggedInUser,
  syncCrossPortWorkspaces,
  getInstanceInfo,
  getUserProfile,
  getUserSettings,
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
  getFiaiSDK,
  WORKSPACE_REGISTRY_ADDRESS,
  CREATE_WORKSPACE_ABI,
  ADD_MEMBER_ABI,
  REMOVE_MEMBER_ABI,
  mapPlaneRoleToContractRole,
  extractEthAddress,
  syncDAppRecord,
  getLastUploadedCID,
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
    (loggedInEmail && u.email?.toLowerCase() === loggedInEmail.toLowerCase())
  );
  if (!activeUser && activeUserId && loggedInEmail) {
    activeUser = createUserObject(activeUserId, loggedInEmail);
    if (!localDB.users) localDB.users = [];
    localDB.users.push(activeUser);
    saveDB();
  }
  if (!activeUser && (localDB.users || []).length > 0) {
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
    const ensureBoardFromIPFS = async (predicate: (b: any) => boolean): Promise<any> => {
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
      if (!cidToFetch && WORKSPACE_REGISTRY_ADDRESS) {
        try {
          const wsInfoCalldata = abiEncodeGetWorkspace("fiai");
          const wsInfoRaw = await directRpcRead(WORKSPACE_REGISTRY_ADDRESS, wsInfoCalldata, 3000);
          const wsInfo = decodeAbiWorkspace(wsInfoRaw);
          if (wsInfo?.ipfsCID && wsInfo.ipfsCID.trim() !== "") {
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
      if (b) return b;

      // Fallback matching
      if (!b && (localDB["project-deploy-boards"] || []).length > 0) {
        b = localDB["project-deploy-boards"][0];
      }
      if (!b) {
        const targetProj = localDB.projects?.[0] || { id: "project-fiai", identifier: "FIAI", name: "FIAI" };
        const targetWs = localDB.workspaces?.[0] || { id: "workspace-fiai", slug: "fiai", name: "FIAI" };
        const defaultAnchor = crypto.randomUUID?.().replace(/-/g, "") || "48c26b7724a243d6a9a7a93a19b5bfb4";
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
      let board = await ensureBoardFromIPFS((b: any) => b.anchor === anchorId || b.id === anchorId);
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

        if (allIssues.length === 0 && (localDB.issues || []).length > 0 && (localDB.projects || []).length <= 1) {
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
      user = createUserObject(`user-${Date.now()}`, email, undefined, undefined, storedHash);
      if (!localDB.users) localDB.users = [];
      localDB.users.push(user);
      saveDB();
    }

    setLoggedInUser(user.id);
    if (typeof window !== "undefined") localStorage.setItem("plane_dapp_auth_email", user.email);
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
    user = createUserObject(`user-${Date.now()}`, email, body?.first_name, body?.last_name, passwordHash);
    if (!localDB.users) localDB.users = [];
    localDB.users.push(user);
    saveDB();
    setLoggedInUser(user.id);
    if (typeof window !== "undefined") localStorage.setItem("plane_dapp_auth_email", user.email);

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
    if (typeof window !== "undefined") localStorage.removeItem("plane_dapp_auth_email");
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
    if (typeof window !== "undefined") localStorage.removeItem("plane_dapp_auth_email");
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
    if (WORKSPACE_REGISTRY_ADDRESS && bridge && currentUserAddress) {
      const initialCid = baseCID || "QmInitial";
      bridge
        .request("sendTransaction", {
          from: currentUserAddress,
          to: WORKSPACE_REGISTRY_ADDRESS,
          abiData: [CREATE_WORKSPACE_ABI],
          functionName: "createWorkspace",
          feeType: "sc",
          amount: "0",
          value: "0",
          gas: "3000000",
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
      const deletedWsSlugs = new Set(localDB._deleted_workspace_slugs || []);
      const deletedWsIds = new Set(localDB._deleted_workspace_ids || []);
      const workspaces = (localDB.workspaces || []).filter(
        (ws: any) => !deletedWsSlugs.has(ws.slug) && !deletedWsIds.has(ws.id)
      );
      return ok(workspaces.map((ws: any) => Object.assign({}, ws, { role: 20 })));
    }

    if (url.includes("/api/users/me/workspaces/invitations") || url.includes("/api/users/me/invitations")) {
      return ok([]);
    }

    if (method === "patch" || method === "put" || method === "post") {
      Object.assign(activeUser, body);
      saveDB();
    }
    return ok(activeUser);
  }

  // ── Projects & Workspace Members ────────────────────────────────────
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/workspace-members\/me\/?/)) {
    const wsSlug = url.match(/\/api\/workspaces\/([^/]+)\/workspace-members\/me\/?/)?.[1] || "";
    const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
    return ok({
      id: "ws-member-me",
      member: activeUser?.id || "me",
      role: 20, // Admin role
      workspace: ws?.id || wsSlug,
      is_active: true,
      created_at: new Date().toISOString(),
    });
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
      const membersList: any[] = [
        {
          id: "ws-member-me",
          member: activeUser || { id: "anonymous", email: "", first_name: "User", last_name: "", display_name: "User" },
          role: 20,
          workspace: ws?.id || wsSlug,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      ];

      const additionalMembers = (localDB.workspace_members || []).filter(
        (m: any) =>
          (m.workspace === wsSlug || m.workspace === ws?.id || m.workspace_id === wsSlug || m.workspace_id === ws?.id) &&
          m.id !== "ws-member-me" &&
          m.member !== (activeUser?.id || "me")
      );

      additionalMembers.forEach((wm: any) => {
        const user = (localDB.users || []).find(
          (u: any) => u.id === wm.member || u.email === wm.member || u.username === wm.member
        );
        const memberKey = String(wm.member || wm.email || wm.id || "");
        const isEth = memberKey.startsWith("0x");
        const shortAddr = isEth ? `${memberKey.slice(0, 6)}...${memberKey.slice(-4)}` : "Member";
        membersList.push({
          id: wm.id,
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
          workspace: ws?.id || wsSlug,
          is_active: wm.is_active !== false,
          created_at: wm.created_at || new Date().toISOString(),
        });
      });

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
      if (memberAddr && WORKSPACE_REGISTRY_ADDRESS && bridge && currentUserAddress) {
        bridge
          .request("sendTransaction", {
            from: currentUserAddress,
            to: WORKSPACE_REGISTRY_ADDRESS,
            abiData: [REMOVE_MEMBER_ABI],
            functionName: "removeMember",
            feeType: "sc",
            amount: "0",
            value: "0",
            gas: "2000000",
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
        if (memberAddr && WORKSPACE_REGISTRY_ADDRESS && bridge && currentUserAddress) {
          const contractRole = mapPlaneRoleToContractRole(body.role);
          bridge
            .request("sendTransaction", {
              from: currentUserAddress,
              to: WORKSPACE_REGISTRY_ADDRESS,
              abiData: [ADD_MEMBER_ABI],
              functionName: "addMember",
              feeType: "sc",
              amount: "0",
              value: "0",
              gas: "2000000",
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
    const deletedSet = new Set(localDB._deleted_project_ids || []);
    const projects = (localDB.projects || [])
      .filter((p: any) => !deletedSet.has(p.id) && !deletedSet.has(p.identifier))
      .map((p: any) => {
        // Calculate next_work_item_sequence from actual issues
        const projectIssues = (localDB.issues || []).filter((i: any) => i.project === p.id || i.project_id === p.id);
        const maxSeq = projectIssues.reduce((max: number, i: any) => Math.max(max, i.sequence_id || 0), 0);
        return Object.assign({}, p, {
          next_work_item_sequence: maxSeq + 1,
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
          return ok(localDB.projects[projectIdx]);
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
  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/projects\/[^/]+\/project-members\/me\/?/)) {
    return ok({
      id: "mock-proj-member-me",
      member: activeUser?.id,
      role: 20, // Admin role
    });
  }

  if (method === "get" && url.match(/\/api\/workspaces\/[^/]+\/projects\/[^/]+\/members\/?(?:\?.*)?$/)) {
    return ok([
      {
        id: "mock-proj-member-me",
        member: activeUser?.id,
        role: 20,
      },
    ]);
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
  if (url.includes("/notifications/unread")) {
    return ok({
      total_unread_notifications_count: 0,
      mention_unread_notifications_count: 0,
    });
  }

  if (url.includes("/notifications")) {
    if (method === "get") {
      return ok({
        results: [],
        count: 0,
        total_count: 0,
        total_pages: 0,
        next_page_results: false,
        prev_page_results: false,
        next_cursor: undefined,
        prev_cursor: undefined,
      });
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
        actor: c.actor || "me",
        actor_detail: c.actor_detail || {
          id: "me",
          first_name: "Plane",
          last_name: "Admin",
          is_bot: false,
          display_name: "Plane Admin",
          avatar: "",
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
  const commentMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/comments\/?(?:\?.*)?$/);
  if (commentMatch) {
    const issueId = commentMatch[2];
    if (method === "get") {
      const comments = (localDB.comments || []).filter((c: any) => c.issue === issueId || c.issue_id === issueId);
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const enrichedComments = comments.map((c: any) => ({
        ...c,
        issue_id: issueId,
        project_id: c.project_id || c.project || issue?.project,
        workspace_id: c.workspace_id || c.workspace || issue?.workspace,
        actor: c.actor || "me",
        actor_detail: { id: "me", first_name: "Plane", last_name: "Admin", is_bot: false, display_name: "Plane Admin" },
      }));
      return ok(enrichedComments);
    }
    if (method === "post") {
      const issue = localDB.issues?.find((i: any) => i.id === issueId);
      const urlWsMatch = url.match(/\/api\/workspaces\/([^/]+)\//);
      const urlProjMatch = url.match(/\/projects\/([^/]+)\//);
      const wsSlug = urlWsMatch ? urlWsMatch[1] : issue?.workspace || localDB.workspaces?.[0]?.slug || "";
      const projId = urlProjMatch ? urlProjMatch[1] : issue?.project || "mock-project";

      const newComment = {
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        issue: issueId,
        issue_id: issueId,
        project_id: projId,
        workspace_id: wsSlug,
        project: projId,
        workspace: wsSlug,
        actor: "me",
        actor_detail: {
          id: "me",
          first_name: "Plane",
          last_name: "Admin",
          is_bot: false,
          display_name: "Plane Admin",
          avatar: "",
        },
        access: "EXTERNAL",
        reaction_groups: {},
        created_by: "me",
        updated_by: "me",
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

  // reactions
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/reactions\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11), ...body });
    if (method === "delete") return ok({});
  }

  // sub-issues
  const subIssuesMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/sub-issues\/?(?:\?.*)?$/);
  if (subIssuesMatch) {
    if (method === "get") {
      const parentId = subIssuesMatch[2];
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
      return ok({ sub_issues: enrichedSubIssues, state_distribution: {} });
    }
    if (method === "post") {
      const parentId = subIssuesMatch[2];
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

        const parentIdx = localDB.issues.findIndex((i: any) => i.id === parentId);
        if (parentIdx > -1) {
          localDB.issues[parentIdx].sub_issues_count = (localDB.issues[parentIdx].sub_issues_count || 0) + updatedSubIssues.length;
        }
        saveDB();
      }

      return ok({ sub_issues: updatedSubIssues, state_distribution: {} });
    }
  }

  // issue-relation
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/issue-relation\/?(?:\?.*)?$/)) {
    if (method === "get") return ok({});
    if (method === "post") return ok({ ...body });
  }

  // links
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/links\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11), ...body });
  }

  // attachments
  const attachmentsMatch = url.match(/\/(issues|work-items|epics)\/([^/]+)\/attachments\/?(?:\?.*)?$/);
  if (attachmentsMatch) {
    const issueId = attachmentsMatch[2];
    if (method === "get") {
      const attachments = (localDB["attachments"] || []).filter((a: any) => a.issue === issueId || a.issue_id === issueId);
      return ok(attachments);
    }
  }

  // description-versions
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/description-versions\/?(?:\?.*)?$/)) {
    return ok([]);
  }

  // modules endpoint for an issue
  if (url.match(/\/(issues|work-items|epics)\/[^/]+\/modules\/?(?:\?.*)?$/)) {
    if (method === "get") return ok([]);
    if (method === "post") return ok({ ...body });
  }


  // search-issues endpoint — delegate to handleCRUD
  if (url.includes("/search-issues") || url.includes("search-issues")) {
    return handleCRUD(method, url, body);
  }
  // ── Generic CRUD ────────────────────────────────────────────────────
  return handleCRUD(method, url, body);
}

// ── Generic CRUD handler ─────────────────────────────────────────────────
function handleCRUD(method: string, url: string, body: Record<string, any>): RouteResult {
  let { collection, id, isPaginated } = parseApiUrl(url);
  console.log(
    `[DApp CRUD] ${method.toUpperCase()} collection=${collection}, id=${id}, isPaginated=${isPaginated}, url=${url}`
  );

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

  // Handle search-issues directly — return ISearchIssueResponse[] format
  if (collection === "search-issues" && method === "get") {
    const urlObj = new URL(url, "http://localhost");
    const searchTerm = (urlObj.searchParams.get("search") || "").toLowerCase();
    const workspaceSearch = urlObj.searchParams.get("workspace_search") === "true";

    let list = [...(localDB.issues || [])];
    console.log(`[DApp CRUD] search-issues: total issues in DB = ${list.length}`);

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

  // Sub-resource collections that don't have persistent storage — return empty stubs
  const subResourceCollections = [
    "history",
    "comments",
    "reactions",
    "sub-issues",
    "issue-relation",
    "links",
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

    if (saveNeeded) saveDB();
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
        return ok({
          is_subscribed: false,
          issue_reactions: [],
          issue_link: [],
          issue_attachments: [],
          parent: null,
          ...item,
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
        const projStates = list.filter((s: any) => s.project === projId);
        if (projStates.length === 0) {
          const match = url.match(/\/api\/workspaces\/([^/]+)\//);
          const wsSlug = match ? match[1] : "unknown";
          let wsId = wsSlug;
          if (localDB.workspaces) {
            const ws = localDB.workspaces.find((w: any) => w.slug === wsSlug);
            if (ws) wsId = ws.id;
          }

          const defaultStates = [
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Backlog",
              group: "backlog",
              project: projId,
              workspace: wsId,
              sequence: 15000,
              color: "#a3a3a3",
              default: true,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Unstarted",
              group: "unstarted",
              project: projId,
              workspace: wsId,
              sequence: 25000,
              color: "#3f3f46",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Started",
              group: "started",
              project: projId,
              workspace: wsId,
              sequence: 35000,
              color: "#f59e0b",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Completed",
              group: "completed",
              project: projId,
              workspace: wsId,
              sequence: 45000,
              color: "#16a34a",
              default: false,
            },
            {
              id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
              name: "Cancelled",
              group: "cancelled",
              project: projId,
              workspace: wsId,
              sequence: 55000,
              color: "#ef4444",
              default: false,
            },
          ];
          list.push(...defaultStates);
          (localDB as any)["states"] = list;
          saveDB();
        }
      }
    }

    // Generic _id suffix mapping for all items to satisfy frontend MobX stores
    list = list.map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const res = { ...item };
      if (res.project && !res.project_id) res.project_id = res.project;
      if (res.workspace && !res.workspace_id) res.workspace_id = res.workspace;
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
          ["issues", "states", "labels", "project-members", "project-roles", "cycles", "modules", "blockchain-transactions"].includes(collection)
        ) {
          list = list.filter((item: any) => matchingProjIds.has(item.project) || matchingProjIds.has(item.project_id));
        }
      }
    } else if (url.includes("/workspaces/") && collection === "labels") {
      const wsMatch = url.match(/\/workspaces\/([^/]+)\//);
      if (wsMatch) {
        const wsSlug = wsMatch[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug || w.id === wsSlug);
        const validWsKeys = new Set([wsSlug, ws?.id, ws?.slug].filter(Boolean));
        list = list.filter((item: any) => validWsKeys.has(item.workspace) || validWsKeys.has(item.workspace_id));
      }
    }

    // Filter sub-resources by issue ID
    if (["comments", "history", "issue_reactions"].includes(collection) && id) {
      list = list.filter((item: any) => item.issue === id || item.issue_id === id);
    }

    if (collection === "invitations") {
      // Fix corrupted old records that have `emails: [{ email, role }]` instead of top-level properties
      list = list.map((item: any) => {
        if (!item.email && item.emails && Array.isArray(item.emails) && item.emails.length > 0) {
          return {
            ...item,
            email: item.emails[0].email,
            role: item.emails[0].role,
          };
        }
        return item;
      });
      list = list.filter((item: any) => !!item.email);
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

      // Pre-initialize groups so empty groups work and show_empty_groups can render
      if (canonicalGroupBy === "state" && collection === "issues") {
        const states = (localDB.states || []).filter((s: any) => s.project === projId || s.project_id === projId);
        states.forEach((s: any) => ensureGroup(s.id));
        ensureGroup("None");
      } else if (canonicalGroupBy === "priority") {
        ["urgent", "high", "medium", "low", "none"].forEach((p) => ensureGroup(p));
      } else if (canonicalGroupBy === "labels") {
        const labels = (localDB.labels || []).filter((l: any) => l.project === projId || l.project_id === projId);
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
          const key = item.state_id || item.state || "None";
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

      const newInvites = body.emails.map((e: any) => ({
        id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        email: e.email,
        role: e.role,
        accepted: false,
        message: "You have been invited.",
        workspace: {
          id: currentWs?.id || wsSlug,
          name: currentWs?.name || "Workspace",
          slug: wsSlug,
          logo_url: "",
        },
      }));

      if (!localDB[collection]) localDB[collection] = [];
      localDB[collection].push(...newInvites);

      // Xử lý từng invitee: ghi nhận vào workspace_members và kích hoạt addMember on-chain nếu có địa chỉ ví
      if (!localDB.workspace_members) localDB.workspace_members = [];

      for (const e of body.emails) {
        const memberAddress = extractEthAddress(e.email);
        const memberKey = memberAddress || e.email;
        const existingIdx = localDB.workspace_members.findIndex(
          (m: any) =>
            (m.workspace === wsSlug || m.workspace_id === wsSlug || m.workspace === currentWs?.id) &&
            (m.member?.toLowerCase() === memberKey.toLowerCase() || m.email?.toLowerCase() === e.email.toLowerCase())
        );
        const memberRecord = {
          id: `ws-member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          workspace: wsSlug,
          workspace_id: wsSlug,
          member: memberKey,
          email: e.email,
          role: e.role || 15,
          is_active: true,
          created_at: new Date().toISOString(),
        };

        if (existingIdx >= 0) {
          localDB.workspace_members[existingIdx] = { ...localDB.workspace_members[existingIdx], ...memberRecord };
        } else {
          localDB.workspace_members.push(memberRecord);
        }

        // Gọi smart contract PlaneWorkspaceRegistry.addMember
        const bridge = getFiaiSDK();
        if (memberAddress && WORKSPACE_REGISTRY_ADDRESS && bridge && currentUserAddress) {
          const contractRole = mapPlaneRoleToContractRole(e.role);
          bridge
            .request("sendTransaction", {
              from: currentUserAddress,
              to: WORKSPACE_REGISTRY_ADDRESS,
              abiData: [ADD_MEMBER_ABI],
              functionName: "addMember",
              feeType: "sc",
              amount: "0",
              value: "0",
              gas: "3000000",
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
      if (match) {
        const wsSlug = match[1];
        const ws = (localDB.workspaces || []).find((w: any) => w.slug === wsSlug);
        if (ws) {
          newRecord.workspace = ws.id;
          newRecord.workspace_detail = ws;
        }
      }
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

    // Generic mapping for all records
    if (returnedRecord.project && !returnedRecord.project_id) returnedRecord.project_id = returnedRecord.project;
    if (returnedRecord.workspace && !returnedRecord.workspace_id)
      returnedRecord.workspace_id = returnedRecord.workspace;

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
    const unpaginatedSub = ["comments", "history", "issue_reactions"];
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

