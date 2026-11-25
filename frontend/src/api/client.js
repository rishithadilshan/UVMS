import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || "/api", timeout: 20000 });

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("uvms_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem("uvms_token");
      sessionStorage.removeItem("uvms_user");
      if (!location.pathname.startsWith("/login")) location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
