import {
  CalendarClock,
  ClipboardList,
  FolderLock,
  KeyRound,
  Mail,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'

export type AuthIntroVariant = 'login' | 'signup' | 'reset'

function LoginIntro() {
  return (
    <>
      <p className="lk-eyebrow">KNOW WHERE TO LOOK</p>
      <h2>Pick up where you left off.</h2>
      <p>Your family list is right where you left it.</p>
      <div className="lk-intro-snapshot" aria-hidden="true">
        <div className="lk-intro-snapshot-head">
          <span>Your family list</span>
          <span className="lk-intro-avatars">
            <i />
            <i />
            <i />
          </span>
        </div>
        {[
          { Icon: ClipboardList, label: 'The list', note: 'Policies, cars and school dates' },
          { Icon: CalendarClock, label: 'Dates', note: 'What is coming up' },
          { Icon: FolderLock, label: 'Papers', note: 'Kept in your vault' },
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
  // A money question picked on the landing page keeps its own path. Otherwise this is the family list.
  const steps = problem
    ? [
        { Icon: KeyRound, title: 'Create your account', note: 'You’re doing this now' },
        { Icon: Wallet, title: 'Enter a few figures', note: 'Savings, monthly costs, any cover' },
        { Icon: ShieldCheck, title: 'See the months', note: 'And the date they depend on' },
        { Icon: Users, title: 'Send the link', note: 'You see when they have opened it' },
      ]
    : [
        { Icon: KeyRound, title: 'Create your account', note: 'You’re doing this now' },
        { Icon: ClipboardList, title: 'Add one thing', note: 'A car, a policy or a school date' },
        {
          Icon: Users,
          title: 'Ask every adult to look',
          note: 'Each one confirms they have seen it',
        },
        {
          Icon: FolderLock,
          title: 'Find it when you need it',
          note: 'One list, one place to look',
        },
      ]
  return (
    <>
      <p className="lk-eyebrow">START FREE</p>
      <h2>{problem ? `Your question: ${problem}.` : 'Your family list starts here.'}</h2>
      <p>
        {problem
          ? 'A few figures in, one answer out. Free to start.'
          : 'Add one thing tonight. The rest can wait. Free to start.'}
      </p>
      <ol className="lk-intro-steps">
        {steps.map(({ Icon, title, note }, i) => (
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
