// Static privacy policy. Linked from the Chrome Web Store listing for the
// "Syrin Note — Side Panel" extension. Intentionally minimal — no auth,
// no tracking, no third-party analytics.
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated: June 14, 2026
      </p>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">About this policy</h2>
        <p>
          This policy covers both the Syrin Note web app at{" "}
          <a href="https://note.syrin.online" className="underline">
            note.syrin.online
          </a>{" "}
          and the “Syrin Note — Side Panel” Chrome extension, which is a thin
          wrapper that loads the same web app inside Chrome's side panel via an
          iframe.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">What the extension does</h2>
        <p>
          The extension contains no business logic. When you click its toolbar
          icon, Chrome opens a side panel that embeds{" "}
          <code>note.syrin.online</code>. All editing, syncing, and storage are
          handled by the web app exactly as they would be in a normal browser
          tab.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Data we collect</h2>
        <p>
          We do not collect personal information. Syrin Note does not require an
          account. Note content is identified by a slug in the URL and synced
          through our backend so the same slug shows the same note across
          devices.
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>No analytics, tracking pixels, or advertising SDKs.</li>
          <li>No reading of the pages you browse.</li>
          <li>No access to your browser history, tabs, cookies, or downloads.</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Permissions we request</h2>
        <p>
          The extension declares one Chrome permission:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>sidePanel</strong> — required so Chrome can render the app
            inside the side panel.
          </li>
        </ul>
        <p>
          We do not request <code>tabs</code>, <code>activeTab</code>,{" "}
          <code>scripting</code>, <code>storage</code>, or any{" "}
          <code>host_permissions</code>.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Storage in the side panel</h2>
        <p>
          Chrome isolates storage by frame. The copy of the app running in the
          side panel has its own <code>localStorage</code>,{" "}
          <code>IndexedDB</code>, and cookies, separate from the copy running in
          a normal tab. As a result, UI state such as recent notes, pinned
          notes, and theme preferences may differ between the side panel and a
          tab. Note <em>content</em> itself is the same in both places because
          it syncs through our backend by slug.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Third parties</h2>
        <p>
          The web app uses a backend provider for note sync and storage. That
          provider only sees the encrypted/plaintext note payloads needed to
          operate the service. The extension itself does not contact any other
          domain than <code>note.syrin.online</code>.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Changes</h2>
        <p>
          If this policy changes materially, the “Last updated” date above will
          change and the new version will be published at this URL before any
          new version of the extension ships.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Contact</h2>
        <p>
          Questions: open an issue at the project repository or reach out via
          the contact link on{" "}
          <a href="https://note.syrin.online" className="underline">
            note.syrin.online
          </a>
          .
        </p>
      </section>
    </main>
  );
}
