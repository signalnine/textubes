import { useState, useEffect } from "react";
import App from "../App";

// Lazy-load PublishedView only when needed
const LazyPublishedView = () => {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    import("./PublishedView").then((mod) => setComponent(() => mod.default));
  }, []);
  if (!Component) return <div style={{ padding: "2rem" }}>Loading...</div>;
  return <Component />;
};

type Route =
  | { type: "editor"; flowId?: string }
  | { type: "published"; flowId: string };

function matchRoute(pathname: string): Route {
  const publishedMatch = pathname.match(/^\/s\/([a-zA-Z0-9]+)$/);
  if (publishedMatch) {
    return { type: "published", flowId: publishedMatch[1]! };
  }

  const editMatch = pathname.match(/^\/edit\/([a-zA-Z0-9]+)$/);
  if (editMatch) {
    return { type: "editor", flowId: editMatch[1]! };
  }

  return { type: "editor" };
}

export default function Router() {
  const [route, setRoute] = useState<Route>(() =>
    matchRoute(window.location.pathname)
  );

  useEffect(() => {
    const handlePopState = () => {
      setRoute(matchRoute(window.location.pathname));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  switch (route.type) {
    case "published":
      return <LazyPublishedView />;
    case "editor":
      return <App initialFlowId={route.flowId} />;
  }
}
