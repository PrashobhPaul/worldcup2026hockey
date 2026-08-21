import { NavLink } from 'react-router-dom'

// A segmented control between sibling homes — Teams↔Players, Oracle↔AI Lab.
// The mobile bar carries five tabs (the FotMob shape), so the two routes that
// left it must stay one obvious tap away rather than becoming lore.
//
// These are page-navigation links, not tabs: no tablist/tab roles (which
// would demand aria-selected the links cannot honestly carry) — NavLink's own
// aria-current="page" is the correct semantics here.
export default function SiblingNav({ items, label }) {
  return (
    <nav aria-label={label ?? 'Related sections'}
      className="mb-4 flex rounded-lg border border-white/5 bg-pitch-800 p-1">
      {items.map(({ to, label: text, end }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) =>
            `flex min-h-[44px] flex-1 items-center justify-center rounded-md px-3 text-center text-xs font-semibold transition-colors ${
              isActive ? 'bg-brand/10 text-brand' : 'text-pitch-400 hover:text-white'
            }`}>
          {text}
        </NavLink>
      ))}
    </nav>
  )
}
