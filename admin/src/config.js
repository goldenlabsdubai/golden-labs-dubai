/**
 * Admin Panel Config - reads from .env (Vite: import.meta.env.VITE_*)
 */
export const config = {
  apiUrl: import.meta.env.VITE_API_URL || "http://localhost:3001/api",
  adminToken: import.meta.env.VITE_ADMIN_TOKEN || "",
};
