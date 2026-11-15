import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import Home from "./site/Home";

// The landing page ships with the entry. Everything else loads when its route is visited,
// so the signed-in app does not wait for the marketing pages and they do not wait for the app.
const Pricing = lazy(() => import("./site/Pricing"));
const Bot = lazy(() => import("./site/Bot"));
const Privacy = lazy(() => import("./site/Privacy"));
const Terms = lazy(() => import("./site/Terms"));
const Contact = lazy(() => import("./site/Contact"));
const Auth = lazy(() => import("./Auth"));
const AppShell = lazy(() => import("./AppShell"));

// A blank screen-high block: nothing to style, and the footer cannot flash up while a page loads.
const loading = <div role="status" aria-label="Loading" style={{ minHeight: "100dvh" }} />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={loading}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/bot" element={<Bot />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/demo" element={<Navigate to="/" replace />} />
          <Route path="/login" element={<Auth mode="login" />} />
          <Route path="/signup" element={<Auth mode="signup" />} />
          <Route path="/app/*" element={<AppShell />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
