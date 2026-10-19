const KEY: { name: string; sr?: string; on: boolean }[] = [
  { name: 'Will', on: true },
  { name: 'Life', on: true },
  { name: 'Income', sr: ' protection', on: false },
  { name: 'Home', on: true },
  { name: 'Savings', on: true },
]

const FAMILY = [
  { name: 'Priya', cls: 'lk-bm', main: true },
  { name: 'Sam', cls: 'lk-bf1 lk-f1' },
  { name: 'Mia', cls: 'lk-bf2 lk-f2' },
  { name: 'Leo', cls: 'lk-bf3 lk-f3' },
]

/** Graticule, berth slips, the family's boats and the lanterns for what is on file. All sample data. */
export function HarbourChart() {
  let lit = 0
  return (
    <>
      <svg className="lk-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line className="h" x1="0" y1="32" x2="100" y2="32" />
        <line className="h" x1="0" y1="52" x2="100" y2="52" />
        <line className="h" x1="0" y1="72" x2="100" y2="72" />
        <line className="v" x1="25" y1="0" x2="25" y2="100" />
        <line className="v" x1="50" y1="0" x2="50" y2="100" />
        <line className="v" x1="75" y1="0" x2="75" y2="100" />
      </svg>
      <ul className="lk-chartkey" aria-label="Sample items on file for the Ellis family">
        {KEY.map((k) => (
          <li
            key={k.name}
            className={k.on ? 'on' : 'off'}
            style={k.on ? ({ '--i': lit++ } as React.CSSProperties) : undefined}
          >
            <svg className="lk-ln" viewBox="0 0 20 30" aria-hidden="true">
              <use href={k.on ? '#lk-lantern' : '#lk-lantern-off'} />
            </svg>
            <b>
              {k.name}
              {k.sr && <span className="lk-sr">{k.sr}</span>}
            </b>
            <span className="st2">{k.on ? 'On file' : 'Not on file'}</span>
          </li>
        ))}
      </ul>
      {FAMILY.map((f) => (
        <i key={`s-${f.name}`} className={`lk-slip ${f.cls.split(' ')[0]}`} aria-hidden="true" />
      ))}
      {FAMILY.map((f) => (
        <div
          key={f.name}
          className={`lk-boat ${f.main ? '' : 'lk-follower'} ${f.cls}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 120 140">
            <use href="#lk-boat" />
          </svg>
          {f.main && (
            <svg className="lk-refl" viewBox="0 0 120 140">
              <use href="#lk-boat" />
            </svg>
          )}
          {f.main && <span className="lk-lamp" />}
          <span className="lk-nm">{f.name}</span>
        </div>
      ))}
    </>
  )
}
