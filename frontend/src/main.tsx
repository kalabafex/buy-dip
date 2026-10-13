import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ApiError, setUnauthorizedHandler } from "@/api/client";
import { qk } from "@/api/queries";
import { App } from "@/App";
import { Toaster } from "@/components/ui/toaster";
import "@fontsource-variable/inter/wght.css";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => {
        // Retry only network errors and unexpected 5xx; not 4xx or 503 (shown gracefully).
        if (err instanceof ApiError && err.status !== 0) {
          return err.status >= 500 && err.status !== 503 && count < 2;
        }
        return count < 2;
      },
    },
    mutations: { retry: false },
  },
});

// Session expired → mark signed-out; <RequireAuth> then redirects to /login.
setUnauthorizedHandler(() => {
  if (queryClient.getQueryData(qk.me) !== null) queryClient.setQueryData(qk.me, null);
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
