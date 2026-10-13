import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useMe } from "@/api/queries";
import { ErrorBox } from "@/components/common";
import { BrandMark } from "@/components/layout/Brand";
import { Skeleton } from "@/components/ui/skeleton";

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        role="status"
        aria-label="Checking session"
      >
        <div className="flex w-64 flex-col items-center gap-4">
          <BrandMark className="h-10 w-10 animate-pulse" />
          <Skeleton className="h-2 w-40" />
        </div>
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox error={me.error} />
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}
