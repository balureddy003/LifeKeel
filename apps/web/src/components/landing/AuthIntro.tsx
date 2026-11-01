import { CalendarClock, FolderLock, KeyRound, Mail, ShieldCheck, Users, Wallet } from 'lucide-react'

export type AuthIntroVariant = 'login' | 'signup' | 'reset'

function LoginIntro() {
  return (
    <>
      <p className="lk-eyebrow">YOUR FAMILY, IN ONE PLACE</p>
      <h2>Pick up where you left off.</h2>
      <p>Everything your family keeps in LifeKeel is right where you left it.</p>
      <div className="lk-intro-snapshot" aria-hidden="true">
        <div className="lk-intro-snapshot-head">
          <span>Your household</span>
          <span className="lk-intro-avatars">
            <i />
            <i />
            <i />
          </span>
        </div>
        {[
          { Icon: FolderLock, label: 'Papers', note: 'Kept in your vault' },
          { Icon: CalendarClock, label: 'Cover', note: 'Renewal dates on file' },
          { Icon: Wallet, label: 'Money', note: 'Accounts in one view' },
        ].map(({ Icon, label, note }) => (
          <div key={label} className="lk-intro-row">
            <Icon size={18} />
            <span>
              <strong>{label}</strong>
              <small>{note}</small>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function SignupIntro({ problem }: { problem?: string | null | undefined }) {
  return (
    <>
      <p className="lk-eyebrow">START FREE</p>
      <h2>{problem ? `Your brief: ${problem}.` : 'Your first brief is next.'}</h2>
      <p>One evening, a few figures, one answer in months. Your first brief is free.</p>
      <ol className="lk-intro-steps">
        {[
          { Icon: KeyRound, title: 'Create your account', note: 'You’re doing this now' },
          { Icon: Wallet, title: 'Enter a few figures', note: 'Savings, monthly costs, any cover' },
          { Icon: ShieldCheck, title: 'See the months', note: 'And the date they depend on' },
          { Icon: Users, title: 'Send the link', note: 'You see when they have opened it' },
        ].map(({ Icon, title, note }, i) => (
          <li key={title} aria-current={i === 0 ? 'step' : undefined}>
            <span className="lk-intro-step-icon">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{note}</small>
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

function ResetIntro() {
  return (
    <>
      <p className="lk-eyebrow">ACCOUNT HELP</p>
      <h2>
        Locked out?
        <br />
        It happens.
      </h2>
      <p>A couple of quick steps and you’re back in.</p>
      <ul className="lk-intro-help">
        {[
          { Icon: Mail, title: 'We email you a link', note: 'It works for 1 hour' },
          { Icon: KeyRound, title: 'Choose a new password', note: 'At least 8 characters' },
          {
            Icon: ShieldCheck,
            title: 'Your records stay put',
            note: 'Nothing in your account changes',
          },
        ].map(({ Icon, title, note }) => (
          <li key={title}>
            <Icon size={20} aria-hidden="true" />
            <strong>{title}</strong>
            <small>{note}</small>
          </li>
        ))}
      </ul>
      <p className="lk-intro-note">
        Didn’t ask for a reset? Ignore the email and your password stays the same.
      </p>
    </>
  )
}

export function AuthIntro({
  variant,
  problem,
}: {
  variant: AuthIntroVariant
  problem?: string | null | undefined
}) {
  return (
    <aside className="lk-auth-intro" data-intro={variant} aria-label="About LifeKeel">
      {variant === 'login' && <LoginIntro />}
      {variant === 'signup' && <SignupIntro problem={problem} />}
      {variant === 'reset' && <ResetIntro />}
    </aside>
  )
}
