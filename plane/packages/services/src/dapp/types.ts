/**
 * Types and interfaces for the Plane DApp decentralization layer
 */

export type RouteResult = {
  data: any;
  status: number;
};

export interface DAppUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  avatar_url: string;
  password_hash?: string | null;
  is_bot: boolean;
  is_active: boolean;
  is_email_verified: boolean;
  is_password_autoset: boolean;
  is_tour_completed: boolean;
  is_onboarded: boolean;
  onboarding_step: Record<string, boolean>;
  mobile_number: string | null;
  last_workspace_id: string;
  last_workspace_slug: string;
  user_timezone: string;
  username: string;
  last_login_medium: string;
  cover_image_url: string | null;
  date_joined: string;
  theme: { theme: string };
  [key: string]: any;
}

export interface DAppWorkspace {
  id: string;
  name: string;
  slug: string;
  organization_size: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  owner: any;
  role: number;
  [key: string]: any;
}

export interface DAppDatabase {
  users: any[];
  workspaces: any[];
  projects: any[];
  states: any[];
  labels: any[];
  issues: any[];
  issue_comments: any[];
  issue_activities: any[];
  attachments: any[];
  views: any[];
  cycles: any[];
  modules: any[];
  pages: any[];
  instance: Record<string, any>;
  _deleted_project_ids?: string[];
  _deleted_issue_ids?: string[];
  [key: string]: any;
}
