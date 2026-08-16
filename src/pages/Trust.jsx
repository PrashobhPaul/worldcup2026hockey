import { Link } from 'react-router-dom'

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-white/5 bg-pitch-800 p-5">
      <h2 className="mb-2 font-display text-base font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-pitch-300">{children}</div>
    </section>
  )
}

export default function TrustPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-brand">Trust Center</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">Trust &amp; Privacy</h1>
        <p className="mt-2 text-sm leading-relaxed text-pitch-300">
          This page is maintained by the app owner and describes the controls actually in place today.
          It is a plain-English summary, not an independent certification.
        </p>
      </div>

      <Section title="What this app does">
        <p>
          Hockey.AI is a read-only analytics dashboard for the FIH Hockey World Cup 2026. It ingests fixtures
          and results, runs a statistical prediction model, and publishes AI-generated match stories.
          No payments, no chat, no user-to-user features.
        </p>
      </Section>

      <Section title="Accounts &amp; authentication">
        <ul className="list-disc space-y-1 pl-5">
          <li>There are no accounts. Every page is public and requires no sign-in.</li>
          <li>The app never asks for, stores, or sees a password, email address, or any personal identifier.</li>
        </ul>
      </Section>

      <Section title="Data we store">
        <ul className="list-disc space-y-1 pl-5">
          <li>Public sports data only: fixtures, results, standings, player statistics and team profiles.</li>
          <li>Model artefacts: pre-published Oracle picks and simulation snapshots, versioned in the open repository.</li>
          <li>On your device: an IndexedDB copy of the same public data so the app works offline. Nothing is sent back.</li>
        </ul>
      </Section>

      <Section title="Zero backend">
        <p>
          There is no server and no database service. GitHub Actions is the entire data plane: a scheduled
          pipeline parses official FIH fixture documents, grades Oracle picks, and commits versioned JSON
          files to the public repository. The app you are reading is static files plus your browser.
        </p>
      </Section>

      <Section title="Third-party services">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>FIH TMS</strong> — official fixtures, results and match documents (read at build time, server-side in CI).</li>
          <li><strong>Anthropic Claude</strong> — generates post-match stories inside the CI pipeline. The API key lives in a repository secret; the browser never calls an AI API.</li>
          <li><strong>Google Fonts</strong> — typefaces, cached by the service worker after first load.</li>
        </ul>
      </Section>

      <Section title="Cookies &amp; tracking">
        <p>
          No cookies, no analytics, no ad or cross-site tracking SDKs. The only browser storage used is the
          offline data cache (IndexedDB) and the PWA service-worker cache.
        </p>
      </Section>

      <Section title="Prediction integrity">
        <p>
          Every Oracle pick is committed to the public repository before push-back, graded automatically after
          full-time, and never edited or deleted. The git history is the audit trail.
        </p>
      </Section>

      <Section title="Reporting an issue">
        <p>
          Found a security or data problem? Open an issue on the published GitHub repository. Please keep
          exploitation details off public channels until acknowledged.
        </p>
      </Section>

      <Section title="What this page is not">
        <p>
          Not an audit, certification, or legal guarantee. No claims are made regarding GDPR, HIPAA, PCI,
          SOC&nbsp;2 or ISO&nbsp;27001 compliance.
        </p>
      </Section>

      <Link to="/" className="inline-block text-sm font-medium text-brand hover:underline">← Back to home</Link>
    </div>
  )
}
