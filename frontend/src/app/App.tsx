import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiClient } from "../api/client";
import type { Schemas } from "../api/types";
import { AuthenticatedApp } from "./AuthenticatedApp";
import { Login } from "./Login";
type User = Schemas["UserResponse"];
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<string>();
  const navigate = useNavigate();
  const location = useLocation();
  const [client] = useState(
    () =>
      new ApiClient(() => {
        setUser(null);
        setNotice("Session expirée. Reconnectez-vous.");
      }),
  );
  function logout() {
    setUser(null);
    setNotice(undefined);
    navigate("/");
    void client.logout().then((revoked) => {
      if (!revoked)
        setNotice(
          "Session locale supprimée. Révocation serveur non confirmée ; le jeton reste soumis à son expiration.",
        );
    });
  }
  return user ? (
    <AuthenticatedApp
      key={user.id}
      client={client}
      user={user}
      logout={logout}
    />
  ) : (
    <Login
      client={client}
      notice={notice}
      onLogin={(current) => {
        setUser(current);
        setNotice(undefined);
        navigate(
          location.pathname.startsWith("/organizations/")
            ? location.pathname
            : "/",
        );
      }}
    />
  );
}
