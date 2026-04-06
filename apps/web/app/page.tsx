const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3400';

const cards = [
  {
    title: 'API',
    body: 'Fastify monolith with project, job, and asset primitives plus health/readiness endpoints.',
  },
  {
    title: 'Worker',
    body: 'BullMQ consumer that dequeues sample jobs and writes completion trace records back to Postgres.',
  },
  {
    title: 'Storage',
    body: 'MinIO-backed S3-compatible bucket used for upload and download smoke paths.',
  },
  {
    title: 'Dev shell',
    body: 'One command starts infra, applies migrations, and boots web, API, and worker together.',
  },
];

export default function Home() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">CardFlow platform foundation</p>
        <h1>Web, API, worker, Postgres, Redis, and storage in one local stack.</h1>
        <p className="lede">
          This scaffold is the first layer of the CardFlow workflow system. It gives the team a
          documented dev shell, a monolith API, a queue consumer, and the persistence/storage wiring
          needed for the product backlog.
        </p>
        <div className="pill-row">
          <span>API: {apiUrl}</span>
          <span>Postgres</span>
          <span>Redis/BullMQ</span>
          <span>S3-compatible storage</span>
        </div>
      </section>

      <section className="grid">
        {cards.map((card) => (
          <article key={card.title} className="card">
            <h2>{card.title}</h2>
            <p>{card.body}</p>
          </article>
        ))}
      </section>

      <section className="footer-panel">
        <h2>Smoke endpoints</h2>
        <ul>
          <li>
            <code>{apiUrl}/healthz</code>
          </li>
          <li>
            <code>{apiUrl}/readyz</code>
          </li>
          <li>
            <code>{apiUrl}/v1/debug/bootstrap</code>
          </li>
        </ul>
      </section>
    </main>
  );
}
