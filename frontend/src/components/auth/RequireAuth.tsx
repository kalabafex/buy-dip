import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useMe } from "@/api/queries";
import { ErrorBox, Loading } from "@/components/common";

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Loading label="Checking session…" />
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
