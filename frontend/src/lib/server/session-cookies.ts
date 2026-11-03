export const ACCESS_COOKIE = 'workspace_access';
export const REFRESH_COOKIE = 'workspace_refresh';

export interface BackendTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn?: string;
}
