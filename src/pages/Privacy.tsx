// Static privacy policy for the web app and Chrome side-panel extension.
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated: July 28, 2026
      </p>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Scope</h2>
        <p>
          This policy covers the Syrin Note web app at{" "}
          <a href="https://note.syrin.online" className="underline">
            note.syrin.online
          </a>{" "}
          and the “Syrin Note — Side Panel” Chrome extension. The extension
          loads that web app in Chrome's side panel and adds settings,
          reliability diagnostics, and a strict-origin messaging bridge.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Data the service handles</h2>
        <p>
          Syrin Note does not require an account. The app handles note content,
          note locators, encryption metadata, and the settings needed to edit,
          sync, share, and recover notes. Unless you enable client-side
          encryption, note content is sent to the backend as plaintext. With
          encryption enabled, ciphertext and operational metadata are still
          sent so the service can store and synchronize the note.
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Lovable Cloud provides the managed database, authentication, Edge
            Functions, backups, hosting, and platform analytics used by the
            service.
          </li>
          <li>
            Cloudflare provides the public security, cache, and response-header
            boundary for the service's public domains.
          </li>
          <li>
            The service may use short-lived anonymous authentication sessions
            when that managed-auth mode is enabled. A capability, not an
            account identity, remains the authority for a note.
          </li>
          <li>The extension does not read page content or browser history.</li>
          <li>
            The app uses browser language preferences and does not use IP geolocation.
            It does not call an IP geolocation service.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Extension permissions and local storage</h2>
        <p>The extension requests two Chrome permissions:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>sidePanel</strong> — opens Syrin Note in Chrome's side
            panel.
          </li>
          <li>
            <strong>storage</strong> — stores the open mode, default or last
            note locator, and debug setting in <code>chrome.storage.sync</code>.
            If sync is unavailable, the panel uses safe defaults rather
            than copying those locators into device-local storage.
          </li>
        </ul>
        <p>
          Device-local <code>chrome.storage.local</code> keeps edit capabilities
          for notes opened through the extension, plus the diagnostics opt-in
          and optional reliability diagnostics. Owner capabilities are never
          stored by the extension or synced between devices. Diagnostics contain
          bounded event names and technical status fields, not note
           content or full URLs. They are never uploaded automatically, can be
           disabled, or cleared in Settings. Events older than 7 days are
           discarded the next time diagnostics are read or written. If the
           extension is not used, expired entries can remain on the device until
           that next use.
          Edit capabilities and diagnostics remain only on that Chrome profile
          until you clear extension data or uninstall the extension. Synced
          settings remain until you clear extension data or uninstall the
          extension, subject to Chrome sync behavior.
        </p>
        <p>
          The extension does not request <code>tabs</code>,{" "}
          <code>activeTab</code>, <code>scripting</code>, or host permissions.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Network processing and logs</h2>
        <p>
          Lovable Cloud and Cloudflare process standard connection metadata such
          as an IP address, user agent, request time, response status, and the
          requested path to host, deliver, measure, and protect the service.
          Provider platform analytics may aggregate path, country, and device
          categories. The application does not intentionally add raw note
          content, ciphertext payloads, note capabilities, share tokens, or raw
          IP addresses to product analytics or application logs.
        </p>
        <p>
          On domains protected by the Cloudflare boundary, the application
          analytics script and collection endpoint are blocked. Cloudflare
          caching is limited to explicit public pages and immutable assets;
          private note, share, unlock, embed, error, and compatibility pages are
          marked private, uncacheable, and non-indexable.
        </p>
        <p>
          Admin abuse protection stores keyed admin abuse-prevention hashes derived
          from a gateway-verified network address, not the raw address, in the app
          database. Failed-attempt hashes become eligible for deletion after seven
          days; a daily retention job removes them, and each admin authentication
          request also runs the same cleanup. Expired opaque admin-session hashes
          are removed by that cleanup as well.
        </p>
        <p>
          Provider-level logs, analytics, backups, and service data follow the
          applicable Lovable Cloud and Cloudflare retention settings and legal
          obligations. Notes remain in the backend until deleted or removed
          under the service's maintenance and recovery processes. A revoked
          share link should no longer grant access.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Chrome Web Store Limited Use</h2>
        <p>
          Information received from Chrome APIs is used only to provide or
          improve the extension's single purpose. It is not sold, used for
          personalized advertising or credit decisions, or made available for
          human review except when you explicitly request support or when needed
          for security, legal compliance, or an allowed business transfer. This
          use complies with the Chrome Web Store User Data Policy, including its
          Limited Use requirements.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Your controls</h2>
        <p>
          You can disable or clear local diagnostics in extension Settings,
          clear browser or extension storage, delete a note where the product
          exposes that control, revoke share links, or uninstall the extension.
          Keep encryption keys and private note links secure; losing an
          encryption key may make encrypted content unrecoverable.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">Changes and contact</h2>
        <p>
          Material changes will update the date above and be published here.
          Questions can be filed in the project repository or through the
          contact link on{" "}
          <a href="https://note.syrin.online" className="underline">
            note.syrin.online
          </a>
          .
        </p>
      </section>
    </main>
  );
}
