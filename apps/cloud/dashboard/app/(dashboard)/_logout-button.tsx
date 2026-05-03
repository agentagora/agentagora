/**
 * Logout button. Server Component that renders a form posting to
 * the `/api/auth/logout` Route Handler — no client JS required, so
 * we can keep the dashboard layout fully server-rendered.
 */

export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post" style={{ margin: 0 }}>
      <button
        type="submit"
        style={{
          background: "transparent",
          border: "1px solid #ccc",
          borderRadius: 6,
          color: "#333",
          padding: "6px 12px",
          fontSize: 13,
          cursor: "pointer",
          width: "100%",
        }}
      >
        Sign out
      </button>
    </form>
  );
}
