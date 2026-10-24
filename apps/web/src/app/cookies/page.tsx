import Link from 'next/link'
import { CookieSettingsButton } from '../privacy/CookieSettingsButton'
import { TRACKERS_CONFIGURED } from '@/lib/consent'

const STORAGE = [
  {
    name: 'Sign-in session',
    technology: 'lifekeel_session cookie',
    purpose:
      'Keeps authenticated API requests signed in. This cookie is not readable by page JavaScript.',
    duration: 'Expires with the session; removed on sign-out.',
  },
  {
    name: 'Appearance',
    technology: 'lifekeel-theme local storage',
    purpose: 'Remembers your light, dark or system theme preference.',
    duration: 'Until you change it or clear site data.',
  },
  {
    name: 'Cookie choice',
    technology: 'lk_cookie_consent_v1 local storage',
    purpose: 'Remembers whether you accepted or rejected optional marketing cookies.',
    duration: 'Until you change it or clear site data.',
  },
  {
    name: 'App preferences and session support',
    technology: 'Local and session storage',
    purpose:
      'Supports account state, preferences and temporary sign-in steps. Exact entries depend on the features you use.',
    duration: 'Varies by entry: for the tab session or until sign-out, reset or site-data removal.',
  },
]

export default function CookiesPage() {
  return (
    <div className="lk-cookie-page">
      <p className="lk-eyebrow">YOUR DEVICE. YOUR CHOICE.</p>
      <h1>
        Cookies &<br />
        device storage.
      </h1>
      <p className="lk-intro">
        Here is what LifeKeel stores on your device, what it is for and how you can control it.
      </p>
      <section>
        <h2>The essentials</h2>
        <p>
          Sign-in and preference storage help the service work. Cookies are small files sent by a
          website; local storage stays in your browser and session storage normally lasts for the
          current tab.
        </p>
        <div className="lk-cookie-table">
          {STORAGE.map((item) => (
            <article key={item.name}>
              <div>
                <h3>{item.name}</h3>
                <p className="lk-fine">{item.technology}</p>
              </div>
              <div>
                <p>{item.purpose}</p>
                <p className="lk-fine">{item.duration}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2>Optional analytics & advertising</h2>
        <p>
          Where configured, Google Analytics, Google Ads, Meta and LinkedIn tags measure public-page
          marketing. They are off until you accept them. They do not run inside your signed-in
          account, invitation links or account-recovery pages.
        </p>
        <p>
          Provider cookies and their lifetimes depend on the tags enabled for this deployment and
          the provider&apos;s configuration. Rejecting optional cookies does not prevent you from
          creating an account or using LifeKeel.
        </p>
      </section>
      <section>
        <h2>Change your choice</h2>
        {TRACKERS_CONFIGURED ? (
          <>
            <p>You can accept, reject or change your optional cookie choice at any time.</p>
            <CookieSettingsButton />
            <p>
              When you withdraw an accepted choice, the page reloads to stop the loaded tags. This
              does not delete cookies already stored by providers; you can remove those through your
              browser&apos;s site-data settings.
            </p>
          </>
        ) : (
          <p>Optional analytics and advertising cookies are not enabled on this site.</p>
        )}
      </section>
      <section>
        <h2>Clear your browser storage</h2>
        <p>
          Your browser lets you block cookies and remove site data. Removing essential storage may
          sign you out or reset your preferences. Cookie choices apply to this browser and device;
          make your choice separately on other devices.
        </p>
        <p>
          For how we use personal information, read our <Link href="/privacy">privacy notice</Link>.
          For help with a choice, visit <Link href="/support">Support</Link>.
        </p>
      </section>
    </div>
  )
}
