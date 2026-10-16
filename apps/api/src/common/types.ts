/** The authenticated principal attached to the request by JwtAuthGuard. */
export interface CurrentUserType {
  sub: string;
  email: string;
  role: string;
  roles: string[];
}
