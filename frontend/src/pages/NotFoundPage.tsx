import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="card narrow">
      <span className="badge badge-neutral">404</span>
      <h1>Page not found</h1>
      <p>The page or resource you requested could not be found.</p>
      <Link className="button button-primary" to="/">
        Return to start
      </Link>
    </div>
  );
}
