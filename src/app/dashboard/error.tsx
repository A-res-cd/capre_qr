'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="loading-page"><h1>Workspace unavailable</h1><p>Check the database connection, then try again.</p><button className="primary" onClick={reset}>Try again</button></main>; }
